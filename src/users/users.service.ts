import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { Prisma, UserStatus } from '@prisma/client';

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
  // TODO(BE-030): Decouple direct Prisma access into UsersRepository and expand unit test coverage (#227)
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: EventsService,
  ) {}

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
