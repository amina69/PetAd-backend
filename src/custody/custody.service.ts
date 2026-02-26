import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { PetAvailabilityService } from '../pets/pet-availability.service';
import { CustodyStatus, EventEntityType, EventType } from '@prisma/client';

@Injectable()
export class CustodyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly availabilityService: PetAvailabilityService,
  ) {}

  /**
   * Create a new custody arrangement
   */
  async createCustody(
    petId: string,
    holderId: string,
    type: string,
    startDate: Date,
    depositAmount?: number,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const pet = await tx.pet.findUnique({
        where: { id: petId },
      });

      if (!pet) {
        throw new NotFoundException('Pet not found');
      }

      const activeCustody = await tx.custody.findFirst({
        where: {
          petId,
          status: CustodyStatus.ACTIVE,
        },
      });

      if (activeCustody) {
        throw new ConflictException('Pet is already in custody');
      }

      const custody = await tx.custody.create({
        data: {
          petId,
          holderId,
          type: type as any,
          startDate,
          depositAmount: depositAmount ? depositAmount.toString() : undefined,
          status: CustodyStatus.ACTIVE,
        },
      });

      await this.events.logEvent({
        entityType: EventEntityType.CUSTODY,
        entityId: custody.id,
        eventType: EventType.CUSTODY_STARTED,
        actorId: holderId,
        payload: { petId },
      });

      // Log availability change due to custody start
      const oldAvailability = await this.availabilityService.resolve(petId);
      await this.availabilityService.logAvailabilityChange(
        petId,
        oldAvailability,
        await this.availabilityService.resolve(petId),
        'custody_started',
        holderId,
      );

      return custody;
    });
  }

  /**
   * Update custody status and trigger availability recalculation
   */
  async updateCustodyStatus(
    custodyId: string,
    newStatus: CustodyStatus,
    actorId?: string,
  ) {
    const custody = await this.prisma.custody.findUnique({
      where: { id: custodyId },
    });

    if (!custody) {
      throw new NotFoundException('Custody not found');
    }

    const oldAvailability = await this.availabilityService.resolve(custody.petId);

    const updatedCustody = await this.prisma.custody.update({
      where: { id: custodyId },
      data: { 
        status: newStatus,
        endDate: newStatus !== CustodyStatus.ACTIVE ? new Date() : undefined,
      },
    });

    // Log the custody status change event
    await this.events.logEvent({
      entityType: EventEntityType.CUSTODY,
      entityId: custodyId,
      eventType: EventType.CUSTODY_RETURNED,
      actorId,
      payload: { oldStatus: custody.status, newStatus },
    });

    // Log availability change
    const newAvailability = await this.availabilityService.resolve(custody.petId);
    await this.availabilityService.logAvailabilityChange(
      custody.petId,
      oldAvailability,
      newAvailability,
      `custody_status_changed_to_${newStatus}`,
      actorId,
    );

    return updatedCustody;
  }

  /**
   * Get active custody for a pet
   */
  async getActiveCustody(petId: string) {
    return this.prisma.custody.findFirst({
      where: {
        petId,
        status: CustodyStatus.ACTIVE,
      },
      include: {
        holder: true,
        pet: true,
      },
    });
  }

  /**
   * Get all custodies for a user
   */
  async getUserCustodies(userId: string) {
    return this.prisma.custody.findMany({
      where: { holderId: userId },
      include: {
        pet: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
