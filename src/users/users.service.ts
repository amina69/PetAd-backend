import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { UPDATABLE_USER_FIELDS, UpdateUserDto } from './dto/update-user.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { PublicProfileDto } from './dto/public-profile.dto';
import { ListUsersDto } from './dto/list-users.dto';
import {
  PaginatedResponseDto,
  PaginationMetaDto,
} from '../common/dto/paginated-response.dto';

export type DeletionBlockCode =
  | 'ACTIVE_CUSTODY'
  | 'OPEN_DISPUTE'
  | 'FUNDED_ESCROW';

export interface DeletionBlocker {
  code: DeletionBlockCode;
  message: string;
  references: string[];
}

export interface DeleteAccountActor {
  actorId: string;
  isSelf: boolean;
}

const USER_PROFILE_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  status: true,
  suspendedAt: true,
  suspensionReason: true,
  phone: true,
  bio: true,
  location: true,
  avatarUrl: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

const SUSPENSION_SELECT = {
  id: true,
  email: true,
  role: true,
  status: true,
  suspendedAt: true,
  suspensionReason: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: EventsService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  async getPublicProfile(id: string): Promise<PublicProfileDto> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        role: true,
        trustScore: true,
        stellarPublicKey: true,
        status: true,
        deletedAt: true,
        createdAt: true,
      },
    });

    if (
      !user ||
      user.status === 'SUSPENDED' ||
      user.status === 'DELETED' ||
      user.deletedAt
    ) {
      throw new NotFoundException('User not found');
    }

    const first = user.firstName ? user.firstName.trim() : '';
    const last = user.lastName ? user.lastName.trim() : '';
    const lastInitial = last ? `${last.charAt(0).toUpperCase()}.` : '';
    const displayName =
      [first, lastInitial].filter(Boolean).join(' ') || 'Anonymous';

    const verifiedBadges: string[] = [];
    if (user.role === 'SHELTER') {
      verifiedBadges.push('VERIFIED_SHELTER');
    }
    if (user.stellarPublicKey) {
      verifiedBadges.push('STELLAR_VERIFIED');
    }
    if (user.trustScore && user.trustScore >= 80) {
      verifiedBadges.push('TOP_RATED');
    }

    const [completedAdoptions, completedCustodies] = await Promise.all([
      this.prisma.adoption.count({
        where: {
          status: 'COMPLETED',
          OR: [{ adopterId: id }, { ownerId: id }],
        },
      }),
      this.prisma.custody.count({
        where: {
          status: 'COMPLETED',
          holderId: id,
        },
      }),
    ]);
    const completedAgreements = completedAdoptions + completedCustodies;

    const ratingSummary = {
      average: user.trustScore ? Number((user.trustScore / 20).toFixed(1)) : 0,
      count: completedAgreements,
    };

    return {
      id: user.id,
      displayName,
      avatarUrl: user.avatarUrl ?? null,
      memberSince: user.createdAt.toISOString(),
      verifiedBadges,
      completedAgreements,
      ratingSummary,
    };
  }

  async getProfile(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_PROFILE_SELECT,
    });

    if (!user) throw new NotFoundException('User not found');

    return user;
  }

  async updateProfile(id: string, dto: UpdateUserDto) {
    // Defence in depth: even if the global ValidationPipe is bypassed, only
    // whitelisted profile fields may be written. `email`, `role` and
    // `trustScore` are never updatable here.
    this.assertOnlyUpdatableFields(dto);

    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, status: true },
    });

    if (!user || user.status === UserStatus.DELETED) {
      throw new NotFoundException('User not found');
    }

    return this.prisma.user.update({
      where: { id },
      data: dto,
      select: USER_PROFILE_SELECT,
    });
  }

  /**
   * Soft-delete an account and anonymise every piece of personal data.
   *
   * The row itself is kept so that adoptions, custodies, documents and the
   * append-only event ledger keep valid foreign keys. Deletion is refused
   * while the user still has obligations (active custody, open dispute or a
   * funded escrow) so funds and animals cannot be stranded.
   */
  async deleteProfile(
    id: string,
    dto: DeleteAccountDto,
    actor: DeleteAccountActor,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        password: true,
        status: true,
        avatarPublicId: true,
      },
    });

    if (!user) throw new NotFoundException('User not found');

    if (user.status === UserStatus.DELETED) {
      throw new ConflictException({
        code: 'ACCOUNT_ALREADY_DELETED',
        message: 'Account has already been deleted',
      });
    }

    if (actor.isSelf) {
      if (!dto?.password) {
        throw new BadRequestException(
          'Password confirmation is required to delete your account',
        );
      }
      const passwordValid = user.password
        ? await bcrypt.compare(dto.password, user.password)
        : false;
      if (!passwordValid) {
        throw new UnauthorizedException('Invalid password');
      }
    }

    const blockers = await this.findDeletionBlockers(id);
    if (blockers.length > 0) {
      throw new ConflictException({
        code: 'ACCOUNT_DELETION_BLOCKED',
        message:
          'Account cannot be deleted while it still has open obligations',
        reasons: blockers,
      });
    }

    const anonymisedEmail = `deleted+${id}@invalid`;

    // External assets are removed first: if Cloudinary is unavailable we
    // still anonymise the database, and only orphaned binaries remain.
    await this.removeAvatar(user.avatarPublicId);
    await this.removeDocuments(id);

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          status: UserStatus.DELETED,
          email: anonymisedEmail,
          password: null,
          firstName: null,
          lastName: null,
          phone: null,
          bio: null,
          location: null,
          avatarUrl: null,
          avatarPublicId: null,
          stellarPublicKey: null,
          deletedAt: now,
        },
      });

      await this.scrubLogs(tx, id, user.email, anonymisedEmail);
    });

    // Ledger payloads only carry ids so replays remain valid without PII.
    await this.eventsService.logEvent({
      entityType: 'USER',
      entityId: id,
      eventType: 'USER_DELETED',
      actorId: actor.actorId,
      payload: { userId: id },
    });

    return {
      message: 'Account deleted successfully',
      userId: id,
      status: UserStatus.DELETED,
    };
  }

  async updateAvatar(
    id: string,
    avatar: { url: string; publicId?: string | null },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, status: true },
    });

    if (!user || user.status === UserStatus.DELETED) {
      throw new NotFoundException('User not found');
    }

    return this.prisma.user.update({
      where: { id },
      data: {
        avatarUrl: avatar.url,
        avatarPublicId: avatar.publicId ?? null,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
      },
    });
  }

  /**
   * Suspends an account. Suspended users keep their data but can no longer
   * authenticate and their listings are hidden from public pet search.
   *
   * @throws NotFoundException if the user does not exist
   * @throws ConflictException if the user is already suspended
   */
  async suspend(userId: string, reason: string, actorId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.status === UserStatus.SUSPENDED) {
      throw new ConflictException('User is already suspended');
    }

    const suspendedAt = new Date();
    const suspensionReason = reason.trim();

    const suspended = await this.prisma.user.update({
      where: { id: userId },
      data: {
        status: UserStatus.SUSPENDED,
        suspendedAt,
        suspensionReason,
      },
      select: SUSPENSION_SELECT,
    });

    await this.eventsService.logEvent({
      entityType: 'USER',
      entityId: userId,
      eventType: 'USER_SUSPENDED',
      actorId,
      payload: {
        userId,
        reason: suspensionReason,
        suspendedAt: suspendedAt.toISOString(),
        suspendedBy: actorId ?? null,
      },
    });

    return suspended;
  }

  /**
   * Reinstates a suspended account, clearing the suspension metadata.
   *
   * @throws NotFoundException if the user does not exist
   * @throws ConflictException if the user is not suspended
   */
  async reinstate(userId: string, actorId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true, suspendedAt: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.status !== UserStatus.SUSPENDED) {
      throw new ConflictException('User is not suspended');
    }

    const reinstated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        status: UserStatus.ACTIVE,
        suspendedAt: null,
        suspensionReason: null,
      },
      select: SUSPENSION_SELECT,
    });

    await this.eventsService.logEvent({
      entityType: 'USER',
      entityId: userId,
      eventType: 'USER_REINSTATED',
      actorId,
      payload: {
        userId,
        reinstatedAt: new Date().toISOString(),
        reinstatedBy: actorId ?? null,
        previousSuspendedAt: user.suspendedAt?.toISOString() ?? null,
      },
    });

    return reinstated;
  }

  /**
   * Admin-only user list with case-insensitive search, role/status
   * filters, pagination and sorting. Never selects the password hash.
   * Page size is hard-capped at 100.
   */
  async listUsers(query: ListUsersDto) {
    const { page = 1, pageSize = 20, q, role, status, sort } = query;

    const limit = Math.min(pageSize || 20, 100);
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = {};

    if (role) {
      where.role = role as UserRole;
    }

    if (status) {
      where.status = status as UserStatus;
    }

    if (q) {
      where.OR = [
        { email: { contains: q, mode: 'insensitive' } },
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
      ];
    }

    let orderBy: Prisma.UserOrderByWithRelationInput = { createdAt: 'desc' };
    if (sort) {
      if (sort.includes(':')) {
        const [field, direction] = sort.split(':');
        orderBy = {
          [field]: direction === 'asc' ? 'asc' : 'desc',
        } as Prisma.UserOrderByWithRelationInput;
      } else {
        orderBy = { [sort]: 'asc' } as Prisma.UserOrderByWithRelationInput;
      }
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          trustScore: true,
          stellarPublicKey: true,
          avatarUrl: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    const meta = new PaginationMetaDto(page, limit, total);
    return new PaginatedResponseDto(users, meta);
  }

  async updateTrustScore(userId: string, delta: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, trustScore: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const newScore = Math.max(0, Math.min(100, user.trustScore + delta));

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { trustScore: newScore },
      select: {
        id: true,
        trustScore: true,
      },
    });

    await this.eventsService.logEvent({
      entityType: 'USER',
      entityId: userId,
      eventType: 'TRUST_SCORE_UPDATED',
      payload: {
        previousScore: user.trustScore,
        newScore,
        delta,
      },
    });

    return updatedUser;
  }

  private assertOnlyUpdatableFields(dto: UpdateUserDto) {
    const allowed = new Set<string>(UPDATABLE_USER_FIELDS);
    const unexpected = Object.keys(dto ?? {}).filter(
      (key) => !allowed.has(key),
    );

    if (unexpected.length > 0) {
      throw new BadRequestException(
        unexpected.map((property) => `property ${property} should not exist`),
      );
    }
  }

  /**
   * Reasons why an account must not be deleted yet. Each blocker carries a
   * stable machine-readable code so clients can explain the refusal.
   */
  private async findDeletionBlockers(
    userId: string,
  ): Promise<DeletionBlocker[]> {
    const blockers: DeletionBlocker[] = [];

    const activeCustodies = await this.prisma.custody.findMany({
      where: {
        holderId: userId,
        status: { in: ['ACTIVE', 'PENDING'] },
      },
      select: { id: true },
    });

    if (activeCustodies.length > 0) {
      blockers.push({
        code: 'ACTIVE_CUSTODY',
        message: 'You are still responsible for an active custody agreement',
        references: activeCustodies.map((custody) => custody.id),
      });
    }

    const openEscrows = await this.prisma.escrow.findMany({
      where: {
        status: { in: ['FUNDED', 'DISPUTED'] },
        OR: [
          {
            adoption: {
              OR: [{ adopterId: userId }, { ownerId: userId }],
            },
          },
          { custody: { holderId: userId } },
        ],
      },
      select: { id: true, status: true },
    });

    const fundedEscrowIds = openEscrows
      .filter((escrow) => escrow.status === 'FUNDED')
      .map((escrow) => escrow.id);

    if (fundedEscrowIds.length > 0) {
      blockers.push({
        code: 'FUNDED_ESCROW',
        message: 'You have a funded escrow that must be settled first',
        references: fundedEscrowIds,
      });
    }

    const disputedEscrowIds = openEscrows
      .filter((escrow) => escrow.status === 'DISPUTED')
      .map((escrow) => escrow.id);

    if (disputedEscrowIds.length > 0) {
      blockers.push({
        code: 'OPEN_DISPUTE',
        message: 'You are part of an open dispute',
        references: disputedEscrowIds,
      });
    }

    return blockers;
  }

  private async removeAvatar(avatarPublicId: string | null) {
    if (!avatarPublicId) return;

    try {
      await this.cloudinary.destroyAsset(avatarPublicId, 'image');
    } catch (error) {
      this.logger.warn(
        `Failed to delete avatar ${avatarPublicId} from Cloudinary: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Documents uploaded by the user are personal data, so both the Cloudinary
   * asset and the database row are removed on account deletion.
   */
  private async removeDocuments(userId: string) {
    const documents = await this.prisma.document.findMany({
      where: { uploadedById: userId },
      select: { id: true, publicId: true },
    });

    if (documents.length === 0) return;

    for (const document of documents) {
      try {
        await this.cloudinary.destroyAsset(document.publicId, 'raw');
      } catch (error) {
        this.logger.warn(
          `Failed to delete document ${document.publicId} from Cloudinary: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    await this.prisma.document.deleteMany({
      where: { id: { in: documents.map((document) => document.id) } },
    });
  }

  /**
   * Application logs are PII-free after deletion: the actor reference is
   * detached and the previous email address is replaced everywhere it was
   * recorded.
   */
  private async scrubLogs(
    tx: Prisma.TransactionClient,
    userId: string,
    previousEmail: string,
    anonymisedEmail: string,
  ) {
    const logs = await tx.appLog.findMany({
      where: { userId },
      select: { id: true, message: true, metadata: true },
    });

    const scrub = (value: string) =>
      previousEmail.length > 0
        ? value.split(previousEmail).join(anonymisedEmail)
        : value;

    for (const log of logs) {
      const data: Prisma.AppLogUpdateInput = {
        userId: null,
        message: scrub(log.message),
      };

      if (log.metadata !== null && log.metadata !== undefined) {
        data.metadata = JSON.parse(
          scrub(JSON.stringify(log.metadata)),
        ) as Prisma.InputJsonValue;
      }

      await tx.appLog.update({ where: { id: log.id }, data });
    }
  }
}
