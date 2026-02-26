import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { AdoptionStatus, CustodyStatus, EventEntityType, EventType } from '@prisma/client';

/**
 * Computed Pet Availability States
 * These replace the stored PetStatus enum values
 */
export enum ComputedPetStatus {
  AVAILABLE = 'AVAILABLE',
  PENDING = 'PENDING',
  IN_CUSTODY = 'IN_CUSTODY',
  ADOPTED = 'ADOPTED',
}

/**
 * Pet Availability Resolver Service
 * 
 * Computes pet availability dynamically from:
 * - Active adoption records
 * - Active custody records  
 * - Ownership data
 * 
 * This eliminates the need for stored pet status and prevents
 * conflicting states like "AVAILABLE but adoption COMPLETED"
 */
@Injectable()
export class PetAvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  /**
   * Resolve pet availability based on current adoption and custody records
   * 
   * Priority Rules:
   * 1. ADOPTED - If Adoption.status = COMPLETED
   * 2. IN_CUSTODY - If Custody.status = ACTIVE  
   * 3. PENDING - If Adoption.status in (REQUESTED, PENDING_REVIEW, APPROVED, ESCROW_FUNDED)
   * 4. AVAILABLE - Otherwise
   * 
   * @param petId - The pet ID to resolve availability for
   * @returns Computed availability status
   */
  async resolve(petId: string): Promise<ComputedPetStatus> {
    // Query latest adoption and active custody records in parallel
    const [latestAdoption, activeCustody] = await Promise.all([
      this.getLatestAdoption(petId),
      this.getActiveCustody(petId),
    ]);

    // Apply priority rules
    if (latestAdoption?.status === AdoptionStatus.COMPLETED) {
      return ComputedPetStatus.ADOPTED;
    }

    if (activeCustody?.status === CustodyStatus.ACTIVE) {
      return ComputedPetStatus.IN_CUSTODY;
    }

    if (latestAdoption && this.isPendingAdoptionStatus(latestAdoption.status)) {
      return ComputedPetStatus.PENDING;
    }

    return ComputedPetStatus.AVAILABLE;
  }

  /**
   * Resolve availability for multiple pets in batch
   * @param petIds - Array of pet IDs
   * @returns Map of petId -> availability status
   */
  async resolveBatch(petIds: string[]): Promise<Map<string, ComputedPetStatus>> {
    const results = new Map<string, ComputedPetStatus>();

    // Get all relevant records in batch for efficiency
    const adoptions = await this.getAdoptionsForPets(petIds);
    const custodies = await this.getCustodiesForPets(petIds);

    for (const petId of petIds) {
      const latestAdoption = this.getLatestAdoptionForPet(petId, adoptions);
      const activeCustody = this.getActiveCustodyForPet(petId, custodies);
      
      results.set(petId, this.resolveFromRecords(latestAdoption, activeCustody));
    }

    return results;
  }

  /**
   * Get pet with computed availability
   * @param petId - Pet ID
   * @returns Pet object with computed availability
   */
  async getPetWithAvailability(petId: string) {
    const pet = await this.prisma.pet.findUnique({
      where: { id: petId },
      include: { currentOwner: true },
    });

    if (!pet) {
      throw new Error(`Pet with ID ${petId} not found`);
    }

    const availability = await this.resolve(petId);

    return {
      ...pet,
      status: availability, // Computed status instead of stored
    };
  }

  /**
   * Get pets with computed availability (for listing)
   * @param options - Query options
   * @returns Pets with computed availability
   */
  async getPetsWithAvailability(options: {
    where?: any;
    skip?: number;
    take?: number;
    orderBy?: any;
  } = {}) {
    const pets = await this.prisma.pet.findMany({
      ...options,
      include: { currentOwner: true },
    });

    const petIds = pets.map(pet => pet.id);
    const availabilityMap = await this.resolveBatch(petIds);

    return pets.map(pet => ({
      ...pet,
      status: availabilityMap.get(pet.id) || ComputedPetStatus.AVAILABLE,
    }));
  }

  /**
   * Log availability change event
   * Called when adoption/custody updates might change availability
   * 
   * @param petId - Pet ID
   * @param oldStatus - Previous computed status
   * @param newStatus - New computed status  
   * @param triggerEvent - What triggered the change
   * @param actorId - User who triggered the change (optional)
   */
  async logAvailabilityChange(
    petId: string,
    oldStatus: ComputedPetStatus,
    newStatus: ComputedPetStatus,
    triggerEvent: string,
    actorId?: string,
  ) {
    if (oldStatus !== newStatus) {
      await this.events.logEvent({
        entityType: EventEntityType.PET,
        entityId: petId,
        eventType: EventType.PET_STATUS_CHANGED,
        actorId,
        payload: {
          oldStatus,
          newStatus,
          triggerEvent,
          timestamp: new Date().toISOString(),
        },
      });
    }
  }

  /**
   * Get latest adoption record for a pet
   * @private
   */
  private async getLatestAdoption(petId: string) {
    return this.prisma.adoption.findFirst({
      where: { petId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get active custody record for a pet
   * @private
   */
  private async getActiveCustody(petId: string) {
    return this.prisma.custody.findFirst({
      where: { 
        petId,
        status: CustodyStatus.ACTIVE,
      },
    });
  }

  /**
   * Get adoptions for multiple pets
   * @private
   */
  private async getAdoptionsForPets(petIds: string[]) {
    return this.prisma.adoption.findMany({
      where: { petId: { in: petIds } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get custodies for multiple pets
   * @private
   */
  private async getCustodiesForPets(petIds: string[]) {
    return this.prisma.custody.findMany({
      where: { 
        petId: { in: petIds },
        status: CustodyStatus.ACTIVE,
      },
    });
  }

  /**
   * Get latest adoption for specific pet from batch results
   * @private
   */
  private getLatestAdoptionForPet(petId: string, adoptions: any[]) {
    return adoptions
      .filter(adoption => adoption.petId === petId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  }

  /**
   * Get active custody for specific pet from batch results
   * @private
   */
  private getActiveCustodyForPet(petId: string, custodies: any[]) {
    return custodies.find(custody => custody.petId === petId);
  }

  /**
   * Resolve availability from adoption and custody records
   * @private
   */
  private resolveFromRecords(latestAdoption: any, activeCustody: any): ComputedPetStatus {
    if (latestAdoption?.status === AdoptionStatus.COMPLETED) {
      return ComputedPetStatus.ADOPTED;
    }

    if (activeCustody?.status === CustodyStatus.ACTIVE) {
      return ComputedPetStatus.IN_CUSTODY;
    }

    if (latestAdoption && this.isPendingAdoptionStatus(latestAdoption.status)) {
      return ComputedPetStatus.PENDING;
    }

    return ComputedPetStatus.AVAILABLE;
  }

  /**
   * Check if adoption status represents a pending state
   * @private
   */
  private isPendingAdoptionStatus(status: AdoptionStatus): boolean {
    const pendingStatuses: AdoptionStatus[] = [
      AdoptionStatus.REQUESTED,
      AdoptionStatus.PENDING,
      AdoptionStatus.APPROVED,
      AdoptionStatus.ESCROW_FUNDED,
    ];
    return pendingStatuses.includes(status);
  }
}
