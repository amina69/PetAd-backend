import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ShelterVerificationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsService } from '../../events/events.service';
import { NotificationQueueService } from '../../jobs/services/notification-queue.service';
import { ApplyShelterDto } from './dto/apply-shelter.dto';
import { RejectShelterDto } from './dto/reject-shelter.dto';

type ShelterProfileWithUser = {
  id: string;
  userId: string;
  orgName: string;
  registrationNumber: string;
  verificationStatus: ShelterVerificationStatus;
  verifiedAt: Date | null;
  createdAt: Date;
  user: { email: string };
};

@Injectable()
export class SheltersService {
  private readonly logger = new Logger(SheltersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: EventsService,
    private readonly notificationQueue: NotificationQueueService,
  ) {}

  /**
   * Submits a shelter onboarding application. The applicant is promoted to
   * the SHELTER role; listings stay blocked until an admin verifies them.
   */
  async apply(userId: string, dto: ApplyShelterDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.role === 'ADMIN') {
      throw new ForbiddenException(
        'Admin accounts cannot apply for shelter verification',
      );
    }

    const existing = await this.prisma.shelterProfile.findUnique({
      where: { userId },
    });
    if (existing) {
      throw new ConflictException(
        'A shelter application already exists for this user',
      );
    }

    const profile = await this.prisma.shelterProfile.create({
      data: {
        userId,
        orgName: dto.orgName,
        registrationNumber: dto.registrationNumber,
        address: dto.address,
        phone: dto.phone,
      },
    });

    if (user.role !== 'SHELTER') {
      await this.prisma.user.update({
        where: { id: userId },
        data: { role: 'SHELTER' },
      });
    }

    return {
      id: profile.id,
      userId: profile.userId,
      orgName: profile.orgName,
      registrationNumber: profile.registrationNumber,
      verificationStatus: profile.verificationStatus,
      isVerified: false,
      createdAt: profile.createdAt,
      message:
        'Shelter application submitted. An admin will review it shortly.',
    };
  }

  /**
   * Approves a pending (or previously rejected) shelter application.
   * Emits a SHELTER_VERIFIED event and notifies the shelter by email.
   */
  async verify(profileId: string, adminId: string) {
    const profile = await this.findProfileWithUser(profileId);

    if (profile.verificationStatus === ShelterVerificationStatus.APPROVED) {
      throw new UnprocessableEntityException('Shelter is already verified');
    }

    const now = new Date();
    const updated = await this.prisma.shelterProfile.update({
      where: { id: profileId },
      data: {
        verificationStatus: ShelterVerificationStatus.APPROVED,
        verifiedAt: now,
      },
    });

    await this.eventsService.logEvent({
      entityType: 'USER',
      entityId: profile.userId,
      eventType: 'SHELTER_VERIFIED',
      actorId: adminId,
      payload: {
        shelterProfileId: profile.id,
        orgName: profile.orgName,
        registrationNumber: profile.registrationNumber,
        verifiedAt: now.toISOString(),
      },
    });

    await this.notifyShelter(profile, true);

    return {
      id: updated.id,
      userId: updated.userId,
      orgName: updated.orgName,
      verificationStatus: updated.verificationStatus,
      verifiedAt: updated.verifiedAt,
      isVerified: true,
      message: 'Shelter verified successfully',
    };
  }

  /**
   * Rejects a pending (or previously approved-free) shelter application.
   */
  async reject(profileId: string, dto: RejectShelterDto) {
    const profile = await this.findProfileWithUser(profileId);

    if (profile.verificationStatus === ShelterVerificationStatus.APPROVED) {
      throw new UnprocessableEntityException(
        'Cannot reject an already verified shelter',
      );
    }

    const updated = await this.prisma.shelterProfile.update({
      where: { id: profileId },
      data: {
        verificationStatus: ShelterVerificationStatus.REJECTED,
        verifiedAt: null,
      },
    });

    await this.notifyShelter(profile, false, dto.reason);

    return {
      id: updated.id,
      userId: updated.userId,
      orgName: updated.orgName,
      verificationStatus: updated.verificationStatus,
      isVerified: false,
      message: 'Shelter application rejected',
    };
  }

  /**
   * Public shelter profile with the verified badge.
   */
  async getPublicProfile(profileId: string) {
    const profile = await this.prisma.shelterProfile.findUnique({
      where: { id: profileId },
    });
    if (!profile) {
      throw new NotFoundException('Shelter profile not found');
    }

    return {
      id: profile.id,
      orgName: profile.orgName,
      address: profile.address,
      phone: profile.phone,
      verificationStatus: profile.verificationStatus,
      isVerified:
        profile.verificationStatus === ShelterVerificationStatus.APPROVED,
      verifiedAt: profile.verifiedAt,
      createdAt: profile.createdAt,
    };
  }

  private async findProfileWithUser(
    profileId: string,
  ): Promise<ShelterProfileWithUser> {
    const profile = await this.prisma.shelterProfile.findUnique({
      where: { id: profileId },
      include: { user: { select: { email: true } } },
    });
    if (!profile) {
      throw new NotFoundException('Shelter profile not found');
    }
    return profile as ShelterProfileWithUser;
  }

  /**
   * Best-effort notification: shelter verification must not fail when the
   * notification queue (Redis) is unavailable.
   */
  private async notifyShelter(
    profile: ShelterProfileWithUser,
    approved: boolean,
    reason?: string,
  ): Promise<void> {
    try {
      await this.notificationQueue.enqueueSendTransactionalEmail({
        dto: {
          to: profile.user.email,
          subject: approved
            ? 'Your PetAd shelter profile is verified'
            : 'Update on your PetAd shelter application',
          text: approved
            ? [
                `Hi ${profile.orgName},`,
                '',
                'Great news! Your shelter profile has been verified by the PetAd team.',
                'A verified badge is now displayed on your public profile and listings.',
                '',
                'The PetAd team',
              ].join('\n')
            : [
                `Hi ${profile.orgName},`,
                '',
                'Your shelter application has been reviewed and could not be approved.',
                ...(reason ? [`Reason: ${reason}`] : []),
                '',
                'The PetAd team',
              ].join('\n'),
        },
        metadata: {
          template: approved ? 'shelter_verified' : 'shelter_rejected',
          shelterProfileId: profile.id,
          orgName: profile.orgName,
        },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Shelter ${approved ? 'verification' : 'rejection'} recorded but notification could not be enqueued for ${profile.orgName}: ${reason}`,
      );
    }
  }
}
