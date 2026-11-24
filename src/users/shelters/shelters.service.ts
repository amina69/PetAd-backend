import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EventEntityType,
  EventType,
  ShelterVerificationStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsService } from '../../events/events.service';
import { NotificationQueueService } from '../../jobs/services/notification-queue.service';
import { ErrorCode } from '../../common/exceptions/error-codes';
import { ApplyShelterDto } from './dto/apply-shelter.dto';
import { RejectShelterDto } from './dto/reject-shelter.dto';

@Injectable()
export class SheltersService {
  private readonly logger = new Logger(SheltersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: EventsService,
    private readonly notificationQueue: NotificationQueueService,
  ) {}

  /**
   * Creates (or re-submits) the onboarding profile of the calling user.
   * Applying grants the SHELTER role, but the account stays unverified and
   * therefore cannot publish listings until an admin approves it.
   */
  async apply(userId: string, dto: ApplyShelterDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        status: true,
        shelterProfile: {
          select: {
            id: true,
            registrationNumber: true,
            verificationStatus: true,
          },
        },
      },
    });

    if (!user || user.status === UserStatus.DELETED) {
      throw new NotFoundException('User not found');
    }

    if (user.role === UserRole.ADMIN) {
      throw new ConflictException('Administrators cannot apply as shelters');
    }

    if (
      user.shelterProfile?.verificationStatus ===
      ShelterVerificationStatus.VERIFIED
    ) {
      throw new ConflictException({
        code: 'SHELTER_ALREADY_VERIFIED',
        message: 'Shelter is already verified',
      });
    }

    const duplicate = await this.prisma.shelterProfile.findFirst({
      where: {
        registrationNumber: dto.registrationNumber,
        ...(user.shelterProfile ? { id: { not: user.shelterProfile.id } } : {}),
      },
      select: { id: true },
    });

    if (duplicate) {
      throw new ConflictException(
        'A shelter with this registration number already exists',
      );
    }

    const profile = user.shelterProfile
      ? await this.prisma.shelterProfile.update({
          where: { id: user.shelterProfile.id },
          data: {
            ...dto,
            verificationStatus: ShelterVerificationStatus.PENDING,
            verifiedAt: null,
            rejectionReason: null,
          },
        })
      : await this.prisma.shelterProfile.create({
          data: { ...dto, userId },
        });

    if (user.role !== UserRole.SHELTER) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { role: UserRole.SHELTER },
      });
    }

    return profile;
  }

  /** Returns the caller's own onboarding profile. */
  async getOwnProfile(userId: string) {
    const profile = await this.prisma.shelterProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundException('Shelter application not found');
    }

    return profile;
  }

  /**
   * Admin approval. Records the verification event and notifies the shelter
   * by email. A notification failure must never roll back a verification
   * that has already been persisted.
   */
  async verify(profileId: string, actorId?: string) {
    const profile = await this.getProfileWithUser(profileId);

    if (profile.verificationStatus === ShelterVerificationStatus.VERIFIED) {
      throw new ConflictException({
        code: 'SHELTER_ALREADY_VERIFIED',
        message: 'Shelter is already verified',
      });
    }

    const verifiedAt = new Date();
    const updated = await this.prisma.shelterProfile.update({
      where: { id: profileId },
      data: {
        verificationStatus: ShelterVerificationStatus.VERIFIED,
        verifiedAt,
        rejectionReason: null,
      },
    });

    await this.eventsService.logEvent({
      entityType: EventEntityType.SHELTER,
      entityId: profileId,
      eventType: EventType.SHELTER_VERIFIED,
      actorId,
      payload: {
        shelterId: profileId,
        userId: profile.userId,
        orgName: profile.orgName,
        verifiedAt: verifiedAt.toISOString(),
        verifiedBy: actorId ?? null,
      },
    });

    await this.notifyShelter(
      profile.user.email,
      'Your shelter account has been verified',
      `Congratulations! ${profile.orgName} is now a verified shelter on PetAd ` +
        'and can publish pet listings.',
    );

    return updated;
  }

  /** Admin rejection. The shelter stays unverified and may re-apply. */
  async reject(
    profileId: string,
    dto: RejectShelterDto = {},
    actorId?: string,
  ) {
    const profile = await this.getProfileWithUser(profileId);

    if (profile.verificationStatus === ShelterVerificationStatus.REJECTED) {
      throw new ConflictException({
        code: 'SHELTER_ALREADY_REJECTED',
        message: 'Shelter application is already rejected',
      });
    }

    const updated = await this.prisma.shelterProfile.update({
      where: { id: profileId },
      data: {
        verificationStatus: ShelterVerificationStatus.REJECTED,
        verifiedAt: null,
        rejectionReason: dto.reason ?? null,
      },
    });

    await this.eventsService.logEvent({
      entityType: EventEntityType.SHELTER,
      entityId: profileId,
      eventType: EventType.SHELTER_REJECTED,
      actorId,
      payload: {
        shelterId: profileId,
        userId: profile.userId,
        orgName: profile.orgName,
        reason: dto.reason ?? null,
        rejectedBy: actorId ?? null,
      },
    });

    return updated;
  }

  /**
   * Throws 403 SHELTER_NOT_VERIFIED when a shelter account has not been
   * verified yet. Non-shelter roles are unaffected.
   */
  async assertCanPublish(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        shelterProfile: { select: { verificationStatus: true } },
      },
    });

    if (
      user?.role === UserRole.SHELTER &&
      user.shelterProfile?.verificationStatus !==
        ShelterVerificationStatus.VERIFIED
    ) {
      throw new ForbiddenException({
        code: ErrorCode.SHELTER_NOT_VERIFIED,
        message: 'Shelter must be verified before publishing pet listings',
      });
    }
  }

  private async getProfileWithUser(profileId: string) {
    const profile = await this.prisma.shelterProfile.findUnique({
      where: { id: profileId },
      include: { user: { select: { id: true, email: true } } },
    });

    if (!profile) {
      throw new NotFoundException('Shelter application not found');
    }

    return profile;
  }

  private async notifyShelter(to: string, subject: string, text: string) {
    try {
      await this.notificationQueue.enqueueSendTransactionalEmail({
        dto: { to, subject, text },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to enqueue shelter notification for ${to}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
