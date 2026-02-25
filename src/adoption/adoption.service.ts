import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { CreateAdoptionDto } from './dto/create-adoption.dto';
import { AdoptionStatus, EventEntityType, EventType } from '@prisma/client';

@Injectable()
export class AdoptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  async requestAdoption(userId: string, dto: CreateAdoptionDto) {
    return this.prisma.$transaction(async (tx) => {
      const pet = await tx.pet.findUnique({
        where: { id: dto.petId },
      });

      if (!pet) {
        throw new NotFoundException('Pet not found');
      }

      if (!pet.currentOwnerId) {
        throw new ConflictException('Pet has no owner assigned');
      }

      const activeAdoption = await tx.adoption.findFirst({
        where: {
          petId: dto.petId,
          status: {
            in: [
              AdoptionStatus.REQUESTED,
              AdoptionStatus.PENDING,
              AdoptionStatus.APPROVED,
              AdoptionStatus.ESCROW_FUNDED,
            ],
          },
        },
      });

      if (activeAdoption) {
        throw new ConflictException('Pet is not available for adoption');
      }

      const adoption = await tx.adoption.create({
        data: {
          petId: dto.petId,
          adopterId: userId,
          ownerId: pet.currentOwnerId,
          notes: dto.notes,
          status: AdoptionStatus.REQUESTED,
        },
      });

      await this.events.logEvent({
        entityType: EventEntityType.ADOPTION,
        entityId: adoption.id,
        eventType: EventType.ADOPTION_REQUESTED,
        actorId: userId,
        payload: { petId: dto.petId },
      });

      return adoption;
    });
  }
}
