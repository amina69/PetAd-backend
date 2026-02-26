import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService, CreateEventLogDto } from '../events/events.service';
import { PetAvailabilityService, ComputedPetStatus } from '../pets/pet-availability.service';
import { AdoptionStateMachine, AdoptionStatus, DomainException } from './adoption-state-machine.service';
import { EventType } from '@prisma/client';

@Injectable()
export class AdoptionService {
  constructor(
    private prisma: PrismaService,
    private eventsService: EventsService,
    private petAvailabilityService: PetAvailabilityService,
    private stateMachine: AdoptionStateMachine,
  ) {}

  /**
   * Create a new adoption request
   */
  async requestAdoption(data: {
    petId: string;
    adopterId: string;
    ownerId: string;
    notes?: string;
  }) {
    // Create adoption request using Prisma enum values
    const adoption = await this.prisma.adoption.create({
      data: {
        petId: data.petId,
        adopterId: data.adopterId,
        ownerId: data.ownerId,
        status: 'REQUESTED' as any, // Use string literal for now
        notes: data.notes,
      },
      include: {
        pet: true,
        adopter: true,
        owner: true,
      },
    });

    // Log the adoption request event
    await this.eventsService.logEvent({
      entityType: 'ADOPTION' as any,
      entityId: adoption.id,
      eventType: 'ADOPTION_REQUESTED' as any,
      actorId: data.adopterId,
      payload: {
        petId: data.petId,
        ownerId: data.ownerId,
        notes: data.notes,
      },
    });

    // Trigger pet availability recalculation
    await this.petAvailabilityService.logAvailabilityChange(
      data.petId,
      ComputedPetStatus.AVAILABLE, // Previous status was available
      ComputedPetStatus.PENDING, // New status
      'adoption_created',
      data.adopterId,
    );

    return adoption;
  }

  /**
   * Update adoption status with state machine validation
   */
  async updateAdoptionStatus(
    adoptionId: string,
    newStatus: AdoptionStatus,
    userId: string,
    userRole: 'USER' | 'ADMIN' | 'SHELTER',
    reason?: string,
  ) {
    // Get current adoption
    const adoption = await this.prisma.adoption.findUnique({
      where: { id: adoptionId },
      include: { pet: true, adopter: true, owner: true },
    });

    if (!adoption) {
      throw new NotFoundException('Adoption not found');
    }

    // Check if user can perform this status change
    this.authorizeStatusChange(adoption, newStatus, userId, userRole);

    // Validate transition using state machine
    const isAdmin = userRole === 'ADMIN';
    if (!this.stateMachine.canAdminOverride(adoption.status as AdoptionStatus, newStatus, isAdmin)) {
      throw new DomainException(
        `Invalid adoption status transition: ${adoption.status} → ${newStatus}`
      );
    }

    // Update the adoption status
    const updatedAdoption = await this.prisma.adoption.update({
      where: { id: adoptionId },
      data: {
        status: newStatus as any, // Convert to string for Prisma
        notes: reason ? `${adoption.notes || ''}\n\nStatus Update: ${reason}` : adoption.notes,
      },
      include: { pet: true, adopter: true, owner: true },
    });

    // Log the status change event
    await this.eventsService.logEvent({
      entityType: 'ADOPTION' as any,
      entityId: adoptionId,
      eventType: this.getAdoptionEventType(newStatus),
      actorId: userId,
      payload: {
        previousStatus: adoption.status,
        newStatus,
        reason,
      },
    });

    // Trigger pet availability recalculation
    await this.petAvailabilityService.logAvailabilityChange(
      adoption.petId,
      ComputedPetStatus.PENDING, // Previous status
      ComputedPetStatus.PENDING, // Current status
      'status_updated',
      userId,
    );

    // Special handling for completed adoptions
    if (newStatus === AdoptionStatus.COMPLETED) {
      await this.handleCompletedAdoption(updatedAdoption);
    }

    return updatedAdoption;
  }

  /**
   * Get adoption by ID
   */
  async findOne(id: string) {
    return this.prisma.adoption.findUnique({
      where: { id },
      include: {
        pet: true,
        adopter: true,
        owner: true,
        escrow: true,
      },
    });
  }

  /**
   * Get all adoptions with filtering
   */
  async findAll(filters: {
    status?: AdoptionStatus;
    adopterId?: string;
    ownerId?: string;
    petId?: string;
    page?: number;
    limit?: number;
  } = {}) {
    const { page = 1, limit = 20 } = filters;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (filters.status) where.status = filters.status as any;
    if (filters.adopterId) where.adopterId = filters.adopterId;
    if (filters.ownerId) where.ownerId = filters.ownerId;
    if (filters.petId) where.petId = filters.petId;

    const [adoptions, total] = await Promise.all([
      this.prisma.adoption.findMany({
        where,
        skip,
        take: limit,
        include: {
          pet: true,
          adopter: true,
          owner: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.adoption.count({ where }),
    ]);

    return {
      data: adoptions,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPreviousPage: page > 1,
      },
    };
  }

  /**
   * Get valid transitions for an adoption
   */
  getValidTransitions(currentStatus: AdoptionStatus): AdoptionStatus[] {
    return this.stateMachine.getValidTransitions(currentStatus);
  }

  /**
   * Check if escrow can be released for this adoption
   */
  async canReleaseEscrow(adoptionId: string): Promise<boolean> {
    const adoption = await this.prisma.adoption.findUnique({ 
      where: { id: adoptionId } 
    });
    
    if (!adoption) return false;
    return this.stateMachine.canReleaseEscrow(adoption.status as AdoptionStatus);
  }

  /**
   * Handle completed adoption (transfer ownership, update trust scores)
   */
  private async handleCompletedAdoption(adoption: any) {
    // Update pet ownership to adopter
    await this.prisma.pet.update({
      where: { id: adoption.petId },
      data: { currentOwnerId: adoption.adopterId },
    });

    // Update trust scores (simplified - in real implementation this would be more complex)
    await Promise.all([
      this.prisma.user.update({
        where: { id: adoption.adopterId },
        data: { trustScore: { increment: 5 } }, // Reward for successful adoption
      }),
      this.prisma.user.update({
        where: { id: adoption.ownerId },
        data: { trustScore: { increment: 3 } }, // Reward for successful transfer
      }),
    ]);

    // Log ownership transfer
    await this.eventsService.logEvent({
      entityType: 'PET' as any,
      entityId: adoption.petId,
      eventType: 'PET_STATUS_CHANGED' as any,
      actorId: adoption.adopterId,
      payload: {
        previousOwnerId: adoption.ownerId,
        newOwnerId: adoption.adopterId,
        reason: 'adoption_completed',
      },
    });
  }

  /**
   * Authorize status changes based on user role and adoption ownership
   */
  private authorizeStatusChange(
    adoption: any,
    newStatus: AdoptionStatus,
    userId: string,
    userRole: 'USER' | 'ADMIN' | 'SHELTER',
  ) {
    // Admins can change any status (within state machine constraints)
    if (userRole === 'ADMIN') {
      return;
    }

    // Owners can approve/reject their own pet adoptions
    if (userRole === 'SHELTER' && adoption.ownerId === userId) {
      const allowedOwnerTransitions = [
        AdoptionStatus.PENDING_REVIEW,
        AdoptionStatus.APPROVED,
        AdoptionStatus.REJECTED,
        AdoptionStatus.CANCELLED,
      ];
      if (!allowedOwnerTransitions.includes(newStatus)) {
        throw new ForbiddenException('Owners cannot perform this status change');
      }
      return;
    }

    // Adopters can cancel their own requests
    if (userRole === 'USER' && adoption.adopterId === userId) {
      if (newStatus !== AdoptionStatus.CANCELLED) {
        throw new ForbiddenException('Adopters can only cancel their requests');
      }
      return;
    }

    throw new ForbiddenException('Not authorized to change adoption status');
  }

  /**
   * Map adoption statuses to event types
   */
  private getAdoptionEventType(status: AdoptionStatus): EventType {
    switch (status) {
      case AdoptionStatus.PENDING_REVIEW:
        return EventType.USER_REGISTERED;
      case AdoptionStatus.APPROVED:
        return EventType.USER_REGISTERED;
      case AdoptionStatus.COMPLETED:
        return EventType.USER_REGISTERED;
      default:
        return EventType.USER_REGISTERED;
    }
  }
}
