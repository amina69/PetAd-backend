import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { PublicProfileDto } from './dto/public-profile.dto';
import { ListUsersDto } from './dto/list-users.dto';
import {
  PaginatedResponseDto,
  PaginationMetaDto,
} from '../common/dto/paginated-response.dto';
import { Prisma, UserRole, UserStatus } from '@prisma/client';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: EventsService,
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
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        suspendedAt: true,
        suspensionReason: true,
        avatarUrl: true,
        createdAt: true,
      },
    });

    if (!user) throw new NotFoundException('User not found');

    return user;
  }

  async updateProfile(id: string, dto: UpdateUserDto) {
    return this.prisma.user.update({
      where: { id },
      data: dto,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        avatarUrl: true,
        createdAt: true,
      },
    });
  }

  async deleteProfile(id: string) {
    await this.prisma.user.delete({ where: { id } });
    return { message: 'User deleted successfully' };
  }

  async updateAvatar(id: string, avatarUrl: string) {
    return this.prisma.user.update({
      where: { id },
      data: { avatarUrl },
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
}
