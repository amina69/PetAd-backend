import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { EscrowService } from '../escrow/escrow.service';
import { UsersService } from '../users/users.service';
import { CustodyStateMachine } from './services/custody-state-machine.service';
import { CreateCustodyDto } from './dto/create-custody.dto';
import { CustodyResponseDto } from './dto/custody-response.dto';
import { CustodyStatus } from '@prisma/client';
import { NotificationQueueService } from '../jobs/services/notification-queue.service';

@Injectable()
export class CustodyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: EventsService,
    private readonly escrowService: EscrowService,
    private readonly usersService: UsersService,
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

    const completedAdoption = await this.prisma.adoption.findFirst({
      where: { petId, status: 'COMPLETED' },
    });
    if (completedAdoption) {
      throw new BadRequestException('Pet is already adopted');
    }

    const activeAdoption = await this.prisma.adoption.findFirst({
      where: {
        petId,
        status: { in: ['REQUESTED', 'PENDING', 'APPROVED', 'ESCROW_FUNDED'] },
      },
    });
    if (activeAdoption) {
      throw new BadRequestException('Pet has an active adoption in progress');
    }

    const activeCustody = await this.prisma.custody.findFirst({
      where: { petId, status: 'ACTIVE' },
    });
    if (activeCustody) {
      throw new BadRequestException(
        'Pet already has an active custody agreement',
      );
    }

    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    if (start < now) {
      throw new BadRequestException('Start date cannot be in the past');
    }

    if (durationDays < 1 || durationDays > 90) {
      throw new BadRequestException(
        'Duration must be between 1 and 90 days',
      );
    }

    const startDateObj = new Date(startDate);
    const endDate = new Date(startDateObj);
    endDate.setDate(endDate.getDate() + durationDays);

    const custody = await this.prisma.$transaction(async (tx) => {
      let escrowId: string | null = null;
      if (depositAmount !== undefined && depositAmount !== null) {
        const escrow = await this.escrowService.createEscrow(
          depositAmount,
          tx,
        );
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
              subject: 'PetAd: Custody Agreement Created',
              text: `Your custody agreement was created for pet ${custody.petId}.`,
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

  async startCustody(
    custodyId: string,
    userId: string,
    role: string,
  ): Promise<CustodyResponseDto> {
    const custody = await this.prisma.custody.findUnique({
      where: { id: custodyId },
      include: { holder: true, pet: true },
    });

    if (!custody) {
      throw new NotFoundException(`Custody with id ${custodyId} not found`);
    }

    if (custody.holderId !== userId && role !== 'ADMIN') {
      throw new ForbiddenException(
        'Only the custodian or an administrator can start custody',
      );
    }

    this.stateMachine.assertCanTransition(
      custody.status,
      CustodyStatus.ACTIVE,
    );

    const startedAt = new Date();
    const updatedCustody = await this.prisma.custody.update({
      where: { id: custodyId },
      data: { status: CustodyStatus.ACTIVE },
      include: { holder: true, pet: true },
    });

    await this.eventsService.logEvent({
      entityType: 'CUSTODY',
      entityId: custodyId,
      eventType: 'CUSTODY_STARTED',
      actorId: userId,
      payload: {
        petId: custody.petId,
        custodianId: custody.holderId,
        startedAt,
        confirmedBy: userId,
      },
    });

    await this.eventsService.logEvent({
      entityType: 'PET',
      entityId: custody.petId,
      eventType: 'PET_CUSTODY_ACTIVE',
      actorId: userId,
      payload: {
        petId: custody.petId,
        custodyId,
        custodianId: custody.holderId,
        startedAt,
        confirmedBy: userId,
      },
    });

    return updatedCustody as CustodyResponseDto;
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
      this.stateMachine.assertCanTransition(
        custody.status,
        CustodyStatus.RETURNED,
      );
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
          fromStatus: custody.status,
          toStatus: CustodyStatus.RETURNED,
          timestamp: new Date().toISOString(),
        },
      });
      if (custody.escrowId) {
        await this.escrowService.releaseEscrow(custody.escrowId);
      }
      await this.usersService.updateTrustScore(custody.holderId, 5);
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
      this.stateMachine.assertCanTransition(
        custody.status,
        CustodyStatus.VIOLATION,
      );
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
          fromStatus: custody.status,
          toStatus: CustodyStatus.VIOLATION,
          timestamp: new Date().toISOString(),
        },
      });
      if (custody.escrowId) {
        await this.escrowService.refundEscrow(custody.escrowId);
      }
      await this.usersService.updateTrustScore(custody.holderId, -15);
      return updatedCustody as CustodyResponseDto;
    });
  }

  async cancelCustody(
    custodyId: string,
    reason?: string,
  ): Promise<CustodyResponseDto> {
    return this.prisma.$transaction(async (tx) => {
      const custody = await tx.custody.findUnique({
        where: { id: custodyId },
        include: { holder: true, pet: true },
      });
      if (!custody) {
        throw new NotFoundException(`Custody with id ${custodyId} not found`);
      }
      this.stateMachine.assertCanTransition(
        custody.status,
        CustodyStatus.CANCELLED,
      );
      const updatedCustody = await tx.custody.update({
        where: { id: custodyId },
        data: { status: CustodyStatus.CANCELLED },
        include: { holder: true, pet: true },
      });
      await this.eventsService.logEvent({
        entityType: 'CUSTODY',
        entityId: custodyId,
        eventType: 'CUSTODY_CANCELLED',
        actorId: custody.holderId,
        payload: {
          petId: custody.petId,
          holderId: custody.holderId,
          fromStatus: custody.status,
          toStatus: CustodyStatus.CANCELLED,
          reason: reason ?? null,
          timestamp: new Date().toISOString(),
        },
      });
      if (custody.escrowId) {
        await this.escrowService.refundEscrow(custody.escrowId);
      }
      return updatedCustody as CustodyResponseDto;
    });
  }
}
