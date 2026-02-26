import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { PetAvailabilityService } from '../pets/pet-availability.service';
import { CreateAdoptionDto } from './dto/create-adoption.dto';
import { AdoptionStatus, EventEntityType, EventType } from '@prisma/client';

@Injectable()
export class AdoptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly availabilityService: PetAvailabilityService,
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

      // Log availability change due to new adoption request
      const oldAvailability = await this.availabilityService.resolve(dto.petId);
      await this.availabilityService.logAvailabilityChange(
        dto.petId,
        oldAvailability,
        await this.availabilityService.resolve(dto.petId),
        'adoption_requested',
        userId,
      );

      return adoption;
    });
  }

  /**
   * Update adoption status and trigger availability recalculation
   */
  async updateAdoptionStatus(
    adoptionId: string,
    newStatus: AdoptionStatus,
    actorId?: string,
  ) {
    const adoption = await this.prisma.adoption.findUnique({
      where: { id: adoptionId },
    });

    if (!adoption) {
      throw new NotFoundException('Adoption not found');
    }

    const oldAvailability = await this.availabilityService.resolve(adoption.petId);

    const updatedAdoption = await this.prisma.adoption.update({
      where: { id: adoptionId },
      data: { status: newStatus },
    });

    // Log the adoption status change event
    await this.events.logEvent({
      entityType: EventEntityType.ADOPTION,
      entityId: adoptionId,
      eventType: this.getAdoptionEventType(newStatus),
      actorId,
      payload: { oldStatus: adoption.status, newStatus },
    });

    // Log availability change
    const newAvailability = await this.availabilityService.resolve(adoption.petId);
    await this.availabilityService.logAvailabilityChange(
      adoption.petId,
      oldAvailability,
      newAvailability,
      `adoption_status_changed_to_${newStatus}`,
      actorId,
    );

    return updatedAdoption;
  }

  /**
   * Get adoption event type based on status
   * @private
   */
  private getAdoptionEventType(status: AdoptionStatus): EventType {
    switch (status) {
      case AdoptionStatus.APPROVED:
        return EventType.ADOPTION_APPROVED;
      case AdoptionStatus.COMPLETED:
        return EventType.ADOPTION_COMPLETED;
      default:
        return EventType.ADOPTION_REQUESTED;
    }
  }
}
