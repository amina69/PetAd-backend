import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';

import {
  EventType,
  EventEntityType,
  AdoptionStatus,
  Prisma,
} from '@prisma/client';

import { CreateAdoptionDto } from './dto/create-adoption.dto';
import { UpdateAdoptionStatusDto } from './dto/update-adoption-status.dto';

const ADOPTION_STATUS_EVENT_MAP: Partial<Record<AdoptionStatus, EventType>> = {
  [AdoptionStatus.APPROVED]: EventType.ADOPTION_APPROVED,
  [AdoptionStatus.COMPLETED]: EventType.ADOPTION_COMPLETED,
};

@Injectable()
export class AdoptionService {
  private readonly logger = new Logger(AdoptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  async approve(adoptionId: string) {
    const adoption = await this.prisma.adoption.findUnique({
      where: { id: adoptionId },
    });

    if (!adoption) throw new NotFoundException('Adoption not found');

    if (adoption.status !== AdoptionStatus.PENDING) {
      throw new BadRequestException('Adoption is not pending');
    }

    return this.prisma.adoption.update({
      where: { id: adoptionId },
      data: { status: AdoptionStatus.APPROVED },
    });
  }

  async reject(adoptionId: string, adminUserId: string, reason?: string) {
    const adoption = await this.prisma.adoption.findUnique({
      where: { id: adoptionId },
    });

    if (!adoption) throw new NotFoundException('Adoption not found');

    if (adoption.status !== AdoptionStatus.PENDING) {
      throw new BadRequestException('Adoption is not pending');
    }

    return this.prisma.adoption.update({
      where: { id: adoptionId },
      data: {
        status: AdoptionStatus.REJECTED,
        notes: reason ?? null,
      },
    });
  }

  async requestAdoption(adopterId: string, dto: CreateAdoptionDto) {
    return this.prisma.$transaction(async (tx) => {
      const pet = await tx.pet.findUnique({ where: { id: dto.petId } });

      if (!pet) {
        throw new NotFoundException(`Pet with id "${dto.petId}" not found`);
      }

      if (!pet.currentOwnerId) {
        throw new ConflictException('Pet has no owner assigned');
      }

      const adoption = await tx.adoption.create({
        data: {
          petId: dto.petId,
          ownerId: pet.currentOwnerId,
          adopterId,
          notes: dto.notes,
          status: AdoptionStatus.REQUESTED,
        },
      });

      await this.events.logEvent({
        entityType: EventEntityType.ADOPTION,
        entityId: adoption.id,
        eventType: EventType.ADOPTION_REQUESTED,
        actorId: adopterId,
        payload: {
          adoptionId: adoption.id,
          petId: dto.petId,
          ownerId: pet.currentOwnerId,
        } satisfies Prisma.InputJsonValue,
      });

      return adoption;
    });
  }

  async updateAdoptionStatus(
    adoptionId: string,
    actorId: string,
    dto: UpdateAdoptionStatusDto,
  ) {
    const existing = await this.prisma.adoption.findUnique({
      where: { id: adoptionId },
    });

    if (!existing) {
      throw new NotFoundException(`Adoption with id "${adoptionId}" not found`);
    }

    const updated = await this.prisma.adoption.update({
      where: { id: adoptionId },
      data: { status: dto.status },
    });

    const eventType = ADOPTION_STATUS_EVENT_MAP[dto.status];

    if (eventType) {
      await this.events.logEvent({
        entityType: EventEntityType.ADOPTION,
        entityId: adoptionId,
        eventType,
        actorId,
        payload: {
          adoptionId,
          newStatus: dto.status,
        } satisfies Prisma.InputJsonValue,
      });
    }

    return updated;
  }
}