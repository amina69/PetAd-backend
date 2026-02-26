import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { CustodyStatus, EventEntityType, EventType } from '@prisma/client';
import { CustodyStatusTransitionValidator } from './validators/custody-status-transition.validator';

@Injectable()
export class CustodyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: EventsService,
  ) {}

  /**
   * Update custody status with state machine validation
   */
  async updateStatus(
    custodyId: string,
    newStatus: CustodyStatus,
    actorId?: string,
  ) {
    // Fetch current custody
    const custody = await this.prisma.custody.findUnique({
      where: { id: custodyId },
      include: {
        holder: true,
        pet: true,
      },
    });

    if (!custody) {
      throw new NotFoundException(`Custody with ID ${custodyId} not found`);
    }

    // Validate transition
    CustodyStatusTransitionValidator.validate(custody.status, newStatus);

    // Update custody status
    const updatedCustody = await this.prisma.custody.update({
      where: { id: custodyId },
      data: {
        status: newStatus,
        ...(newStatus !== CustodyStatus.ACTIVE && { endDate: new Date() }),
      },
      include: {
        holder: true,
        pet: true,
      },
    });

    // Log timeline event
    await this.eventsService.logEvent({
      entityType: EventEntityType.CUSTODY,
      entityId: custodyId,
      eventType: this.getEventTypeForStatus(newStatus),
      actorId,
      payload: {
        custodyId,
        previousStatus: custody.status,
        newStatus,
        holderId: custody.holderId,
        petId: custody.petId,
      },
      metadata: {
        holderEmail: custody.holder.email,
        petName: custody.pet.name,
      },
    });

    // Update trust score on VIOLATION
    if (newStatus === CustodyStatus.VIOLATION) {
      await this.updateTrustScoreOnViolation(custody.holderId, actorId);
    }

    return updatedCustody;
  }

  /**
   * Get event type based on custody status
   */
  private getEventTypeForStatus(status: CustodyStatus): EventType {
    switch (status) {
      case CustodyStatus.RETURNED:
        return EventType.CUSTODY_RETURNED;
      case CustodyStatus.ACTIVE:
        return EventType.CUSTODY_STARTED;
      default:
        // For CANCELLED and VIOLATION, we'll use a generic event
        // You may want to add specific event types to the enum
        return EventType.CUSTODY_RETURNED; // Fallback
    }
  }

  /**
   * Update trust score when violation occurs
   */
  private async updateTrustScoreOnViolation(
    holderId: string,
    actorId?: string,
  ) {
    const VIOLATION_PENALTY = 10; // Reduce trust score by 10 points

    const user = await this.prisma.user.findUnique({
      where: { id: holderId },
    });

    if (!user) {
      return;
    }

    const newTrustScore = Math.max(0, user.trustScore - VIOLATION_PENALTY);

    await this.prisma.user.update({
      where: { id: holderId },
      data: { trustScore: newTrustScore },
    });

    // Log trust score update event
    await this.eventsService.logEvent({
      entityType: EventEntityType.USER,
      entityId: holderId,
      eventType: EventType.TRUST_SCORE_UPDATED,
      actorId,
      payload: {
        userId: holderId,
        previousScore: user.trustScore,
        newScore: newTrustScore,
        reason: 'CUSTODY_VIOLATION',
        penalty: VIOLATION_PENALTY,
      },
    });
  }

  /**
   * Get custody by ID
   */
  async findOne(custodyId: string) {
    const custody = await this.prisma.custody.findUnique({
      where: { id: custodyId },
      include: {
        holder: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            trustScore: true,
          },
        },
        pet: true,
      },
    });

    if (!custody) {
      throw new NotFoundException(`Custody with ID ${custodyId} not found`);
    }

    return custody;
  }

  /**
   * Get allowed transitions for a custody
   */
  async getAllowedTransitions(custodyId: string) {
    const custody = await this.findOne(custodyId);

    return {
      currentStatus: custody.status,
      allowedTransitions:
        CustodyStatusTransitionValidator.getAllowedTransitions(custody.status),
      isTerminal: CustodyStatusTransitionValidator.isTerminalState(
        custody.status,
      ),
    };
  }
}
