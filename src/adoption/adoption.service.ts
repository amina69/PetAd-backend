import { Injectable, Optional } from '@nestjs/common';
import { EventEntityType, EventType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventLedgerService } from '../events/event-ledger.service';
import { AdoptionStateMachineService } from './services/adoption-state-machine.service';
import { CreateAdoptionDto } from './dto/create-adoption.dto';
import { FilterAdoptionsDto } from './dto/filter-adoptions.dto';
import { UpdateAdoptionStatusDto } from './dto/update-adoption-status.dto';

@Injectable()
export class AdoptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adoptionStateMachine: AdoptionStateMachineService,
    @Optional() private readonly eventLedgerService?: EventLedgerService,
  ) {}

  async create(userId: string, dto: CreateAdoptionDto) {
    return this.prisma.adoption.create({
      data: {
        ...(dto as any),
        adopterId: userId,
      },
    });
  }

  async findAll(filters?: FilterAdoptionsDto) {
    return this.prisma.adoption.findMany({
      where: filters as any,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    return this.prisma.adoption.findUnique({
      where: { id },
    });
  }

  async updateStatus(
    id: string,
    dto: UpdateAdoptionStatusDto,
    actorId?: string,
  ) {
    if (dto.status === 'APPROVED' && actorId) {
      return this.approve(id, actorId);
    }

    const adoption = await this.prisma.adoption.findUnique({
      where: { id },
    });

    if (!adoption) {
      return null;
    }

    if (this.adoptionStateMachine && actorId) {
      await this.adoptionStateMachine.validateTransition(
        adoption.status,
        dto.status,
      );
    }

    return this.prisma.adoption.update({
      where: { id },
      data: { status: dto.status },
    });
  }

  async approve(adoptionId: string, approvedBy: string) {
    const adoption = await this.prisma.adoption.findUnique({
      where: { id: adoptionId },
    });

    if (!adoption) {
      return null;
    }

    if (this.adoptionStateMachine) {
      await this.adoptionStateMachine.validateTransition(
        adoption.status,
        'APPROVED',
      );
    }

    const approvedAt = new Date();
    const updatedAdoption = await this.prisma.adoption.update({
      where: { id: adoptionId },
      data: {
        status: 'APPROVED',
      },
    });

    if (this.eventLedgerService) {
      const payload = {
        petId: adoption.petId,
        adopterId: adoption.adopterId,
        approvedBy,
        approvedAt: approvedAt.toISOString(),
        escrowAmount:
          adoption.escrowAmount === null || adoption.escrowAmount === undefined
            ? ''
            : String(adoption.escrowAmount),
      };

      await this.eventLedgerService.appendEvent({
        entityType: EventEntityType.ADOPTION,
        aggregateId: adoption.id,
        eventType: EventType.ADOPTION_APPROVED,
        actorId: approvedBy,
        payload,
      });

      await this.eventLedgerService.appendEvent({
        entityType: EventEntityType.PET,
        aggregateId: adoption.petId,
        eventType: 'PET_ADOPTION_APPROVED' as EventType,
        actorId: approvedBy,
        payload,
      });
    }

    return updatedAdoption;
  }

  async reject(id: string, actorId: string) {
    return this.updateStatus(
      id,
      { status: 'REJECTED' } as UpdateAdoptionStatusDto,
      actorId,
    );
  }
}
