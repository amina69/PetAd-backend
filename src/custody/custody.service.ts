import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { EscrowService } from '../escrow/escrow.service';
import { UsersService } from '../users/users.service';
import { CreateCustodyDto } from './dto/create-custody.dto';
import { CustodyResponseDto } from './dto/custody-response.dto';
import { CustodyStatus, EventType, EventEntityType } from '@prisma/client';
import { NotificationQueueService } from '../jobs/services/notification-queue.service';
import { PetAvailabilityService } from '../pets/services/pet-availability.service';
import { CustodyStateMachine } from './custody-state-machine.service';

@Injectable()
export class CustodyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: EventsService,
    private readonly escrowService: EscrowService,
    private readonly usersService: UsersService,
    private readonly petAvailabilityService: PetAvailabilityService,
    private readonly stateMachine: CustodyStateMachine,
    @Optional()
    private readonly notificationQueueService?: NotificationQueueService,
  ) {}

  async createCustody(
    userId: string,
    dto: CreateCustodyDto,
  ): Promise<CustodyResponseDto> {
    const { petId, startDate, durationDays, depositAmount } = dto;

    const pet = await this.prisma.pet.findUnique({ where: { id: petId } });

    if (!pet) {
      throw new NotFoundException(`Pet with id ${petId} not found`);
    }

    // Check if pet is adopted
    const completedAdoption = await this.prisma.adoption.findFirst({
      where: { petId, status: 'COMPLETED' },
    });
    if (completedAdoption) {
      throw new BadRequestException('Pet is already adopted');
    }

    // Check for in-progress adoption
    const activeAdoption = await this.prisma.adoption.findFirst({
      where: {
        petId,
        status: { in: ['REQUESTED', 'PENDING', 'APPROVED', 'ESCROW_FUNDED'] },
      },
    });
    if (activeAdoption) {
      throw new BadRequestException('Pet has an active adoption in progress');
    }

    // Check for active custody
    const activeCustody = await this.prisma.custody.findFirst({
      where: { petId, status: CustodyStatus.ACTIVE },
    });
    if (activeCustody) {
      throw new BadRequestException('Pet already has an active custody agreement');
    }

    // Validate startDate is not in the past
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    if (start < now) {
      throw new BadRequestException('Start date cannot be in the past');
    }

    if (durationDays < 1 || durationDays > 90) {
      throw new BadRequestException('Duration must be between 1 and 90 days');
    }

    const startDateObj = new Date(startDate);
    const endDate = new Date(startDateObj);
    endDate.setDate(endDate.getDate() + durationDays);

    const custody = await this.prisma.$transaction(async (tx) => {
      let escrowId: string | null = null;

      if (depositAmount !== undefined && depositAmount !== null) {
        const escrow = await this.escrowService.createEscrow(depositAmount, tx);
        escrowId = escrow.id;
      }

      return tx.custody.create({
        data: {
          status: CustodyStatus.PENDING,
          type: 'TEMPORARY',
          holderId: userId,
          petId,
          startDate: startDateObj,
          endDate,
          depositAmount: depositAmount ?? null,
          escrowId,
        },
        include: { pet: true },
      });
    });

    await this.eventsService.logEvent({
      entityType: 'CUSTODY',
      entityId: custody.id,
      eventType: 'CUSTODY_STARTED',
      actorId: userId,
      payload: {
        petId: custody.petId,
        startDate: custody.startDate,
        endDate: custody.endDate,
        depositAmount: custody.depositAmount,
      },
    });

    await this.eventsService.logEvent({
      entityType: EventEntityType.PET,
      entityId: custody.petId,
      eventType: EventType.PET_AVAILABILITY_CHANGED,
      actorId: userId,
      payload: {
        petId: custody.petId,
        newAvailability: await this.petAvailabilityService.resolve(custody.petId),
        reason: 'custody_started',
        custodyId: custody.id,
      },
    });

    if (this.notificationQueueService) {
      try {
        const holder = await this.prisma.user.findUnique({
          where: { id: custody.holderId },
          select: { email: true },
        });
        if (holder?.email) {
          await this.notificationQueueService.enqueueSendTransactionalEmail({
            dto: {
              to: holder.email,
              subject: 'PetAd: Custody Agreement Started',
              text: `Hello! Your custody agreement has started for pet ${custody.petId}.`,
            },
            metadata: { custodyId: custody.id, petId: custody.petId },
          });
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.error(
          `Failed to enqueue custody notification email | custodyId=${custody.id} | reason=${reason}`,
        );
      }
    }

    return custody as CustodyResponseDto;
  }

  /**
   * Transitions a PENDING custody → ACTIVE.
   * This is the "activate" step once the start date arrives or admin confirms.
   */
  async activateCustody(custodyId: string, actorId: string): Promise<CustodyResponseDto> {
    return this.prisma.$transaction(async (tx) => {
      const custody = await tx.custody.findUnique({
        where: { id: custodyId },
        include: { holder: true, pet: true },
      });

      if (!custody) {
        throw new NotFoundException(`Custody with id ${custodyId} not found`);
      }

      // State machine guards this transition
      this.stateMachine.assertTransition(custody.status, CustodyStatus.ACTIVE);

      const updatedCustody = await tx.custody.update({
        where: { id: custodyId },
        data: { status: CustodyStatus.ACTIVE },
        include: { holder: true, pet: true },
      });

      await this.eventsService.logEvent({
        entityType: EventEntityType.CUSTODY,
        entityId: custodyId,
        eventType: EventType.CUSTODY_ACTIVATED,
        actorId,
        payload: {
          petId: custody.petId,
          holderId: custody.holderId,
          previousStatus: custody.status,
        },
      });

      const newAvailability = await this.petAvailabilityService.resolve(custody.petId);
      await this.eventsService.logEvent({
        entityType: EventEntityType.PET,
        entityId: custody.petId,
        eventType: EventType.PET_AVAILABILITY_CHANGED,
        actorId,
        payload: {
          petId: custody.petId,
          newAvailability,
          reason: 'custody_activated',
          custodyId,
        },
      });

      return updatedCustody as CustodyResponseDto;
    });
  }

  async returnCustody(custodyId: string): Promise<CustodyResponseDto> {
    return this.prisma.$transaction(async (tx) => {
      const custody = await tx.custody.findUnique({
        where: { id: custodyId },
        include: { holder: true, pet: true },
      });

      if (!custody) {
        throw new NotFoundException(`Custody with id ${custodyId} not found`);
      }

      // State machine guards this transition
      this.stateMachine.assertTransition(custody.status, CustodyStatus.RETURNED);

      const updatedCustody = await tx.custody.update({
        where: { id: custodyId },
        data: { status: CustodyStatus.RETURNED },
        include: { holder: true, pet: true },
      });

      await this.eventsService.logEvent({
        entityType: 'CUSTODY',
        entityId: custodyId,
        eventType: 'CUSTODY_RETURNED',
        actorId: custody.holderId,
        payload: {
          petId: custody.petId,
          holderId: custody.holderId,
        },
      });

      const newAvailability = await this.petAvailabilityService.resolve(custody.petId);
      await this.eventsService.logEvent({
        entityType: EventEntityType.PET,
        entityId: custody.petId,
        eventType: EventType.PET_AVAILABILITY_CHANGED,
        actorId: custody.holderId,
        payload: {
          petId: custody.petId,
          newAvailability,
          reason: 'custody_returned',
          custodyId,
        },
      });

      if (custody.escrowId) {
        await this.escrowService.releaseEscrow(custody.escrowId);
      }

      await this.usersService.updateTrustScore(custody.holderId, 5);

      return updatedCustody as CustodyResponseDto;
    });
  }

  async cancelCustody(custodyId: string, actorId: string): Promise<CustodyResponseDto> {
    return this.prisma.$transaction(async (tx) => {
      const custody = await tx.custody.findUnique({
        where: { id: custodyId },
        include: { holder: true, pet: true },
      });

      if (!custody) {
        throw new NotFoundException(`Custody with id ${custodyId} not found`);
      }

      // State machine guards this transition (PENDING or ACTIVE → CANCELLED)
      this.stateMachine.assertTransition(custody.status, CustodyStatus.CANCELLED);

      const updatedCustody = await tx.custody.update({
        where: { id: custodyId },
        data: { status: CustodyStatus.CANCELLED },
        include: { holder: true, pet: true },
      });

      await this.eventsService.logEvent({
        entityType: EventEntityType.CUSTODY,
        entityId: custodyId,
        eventType: EventType.CUSTODY_CANCELLED,
        actorId,
        payload: {
          petId: custody.petId,
          holderId: custody.holderId,
          previousStatus: custody.status,
        },
      });

      const newAvailability = await this.petAvailabilityService.resolve(custody.petId);
      await this.eventsService.logEvent({
        entityType: EventEntityType.PET,
        entityId: custody.petId,
        eventType: EventType.PET_AVAILABILITY_CHANGED,
        actorId,
        payload: {
          petId: custody.petId,
          newAvailability,
          reason: 'custody_cancelled',
          custodyId,
        },
      });

      // Refund escrow if present
      if (custody.escrowId) {
        await this.escrowService.refundEscrow(custody.escrowId);
      }

      return updatedCustody as CustodyResponseDto;
    });
  }

  async violationCustody(custodyId: string): Promise<CustodyResponseDto> {
    return this.prisma.$transaction(async (tx) => {
      const custody = await tx.custody.findUnique({
        where: { id: custodyId },
        include: { holder: true, pet: true },
      });

      if (!custody) {
        throw new NotFoundException(`Custody with id ${custodyId} not found`);
      }

      // State machine guards this transition
      this.stateMachine.assertTransition(custody.status, CustodyStatus.VIOLATION);

      const updatedCustody = await tx.custody.update({
        where: { id: custodyId },
        data: { status: CustodyStatus.VIOLATION },
        include: { holder: true, pet: true },
      });

      await this.eventsService.logEvent({
        entityType: 'CUSTODY',
        entityId: custodyId,
        eventType: 'CUSTODY_VIOLATION',
        actorId: custody.holderId,
        payload: {
          petId: custody.petId,
          holderId: custody.holderId,
        },
      });

      const newAvailability = await this.petAvailabilityService.resolve(custody.petId);
      await this.eventsService.logEvent({
        entityType: EventEntityType.PET,
        entityId: custody.petId,
        eventType: EventType.PET_AVAILABILITY_CHANGED,
        actorId: custody.holderId,
        payload: {
          petId: custody.petId,
          newAvailability,
          reason: 'custody_violation',
          custodyId,
        },
      });

      if (custody.escrowId) {
        await this.escrowService.refundEscrow(custody.escrowId);
      }

      await this.usersService.updateTrustScore(custody.holderId, -15);

      return updatedCustody as CustodyResponseDto;
    });
  }
}
