import {
  Injectable,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DisputeStatus, DisputeOutcome } from '@prisma/client';
import { Role } from '../auth/enums/role.enum';

export interface ResolveDisputeInput {
  outcome: DisputeOutcome;
  resolution: string;
  splitPercent?: number;
}

@Injectable()
export class DisputeResolutionService {
  constructor(private readonly prisma: PrismaService) {}

  async assignAdmin(disputeId: string, adminId: string, actorRole: string) {
    if (actorRole !== Role.ADMIN) throw new ForbiddenException();

    const dispute = await this.prisma.dispute.findUniqueOrThrow({
      where: { id: disputeId },
    });

    if (dispute.status === DisputeStatus.RESOLVED) {
      throw new ConflictException('DISPUTE_INVALID_TRANSITION');
    }

    return this.prisma.dispute.update({
      where: { id: disputeId },
      data: { status: DisputeStatus.UNDER_REVIEW },
    });
  }

  async resolve(
    disputeId: string,
    dto: ResolveDisputeInput,
    actorId: string,
    actorRole: string,
  ) {
    if (actorRole !== Role.ADMIN) throw new ForbiddenException();

    if (dto.outcome === DisputeOutcome.SPLIT && dto.splitPercent == null) {
      throw new BadRequestException('splitPercent required for SPLIT outcome');
    }

    const dispute = await this.prisma.dispute.findUniqueOrThrow({
      where: { id: disputeId },
    });

    if (dispute.status === DisputeStatus.RESOLVED) {
      throw new ConflictException('DISPUTE_INVALID_TRANSITION');
    }

    return this.prisma.dispute.update({
      where: { id: disputeId },
      data: {
        status: DisputeStatus.RESOLVED,
        resolution: dto.resolution,
        resolvedById: actorId,
        resolvedAt: new Date(),
      },
    });
  }

  async retrySettlement(disputeId: string, actorId: string, actorRole: string) {
    if (actorRole !== Role.ADMIN) throw new ForbiddenException();

    await this.prisma.dispute.findUniqueOrThrow({ where: { id: disputeId } });

    // Stub: settlement retry logic goes here when escrow integration is wired.
    return { disputeId, retried: true, actorId };
  }
}
