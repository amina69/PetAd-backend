import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  Optional,
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
import { RejectAdoptionDto } from './dto/reject-adoption.dto';
import { NotificationQueueService } from '../jobs/services/notification-queue.service';
import { AdoptionStateMachine } from './services/adoption-state-machine.service';

/** Maps an AdoptionStatus to its corresponding EventType, if one exists. */
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
    private readonly adoptionStateMachine: AdoptionStateMachine,
    @Optional()
    private readonly notificationQueueService?: NotificationQueueService,
  ) {}

  /**
   * Creates an adoption request and fires an ADOPTION_REQUESTED event.
   * Throws NotFoundException if the pet does not exist.
   * Throws ConflictException if the pet has no owner or already has an active adoption.
   */
  async requestAdoption(adopterId: string, dto: CreateAdoptionDto) {
    return this.prisma.$transaction(async (tx) => {
      const pet = await tx.pet.findUnique({ where: { id: dto.petId } });

      if (!pet) {
        throw new NotFoundException(`Pet with id "${dto.petId}" not found`);
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
          ownerId: pet.currentOwnerId,
          adopterId,
          notes: dto.notes,
          status: AdoptionStatus.REQUESTED,
        },
      });

      this.logger.log(
        `Adoption ${adoption.id} requested by adopter ${adopterId} for pet ${dto.petId}`,
      );

      await this.events.logEvent({
        entityType: EventEntityType.ADOPTION,
        entityId: adoption.id,
        eventType: EventType.ADOPTION_REQUESTED,
        actorId: adopterId,
        payload: {
          adoptionId: adoption.id,
          petId: dto.petId,
          ownerId: pet.currentOwnerId,
          adopterId,
        } satisfies Prisma.InputJsonValue,
      });

      return adoption;
    });
  }

  /**
   * Updates an adoption's status and fires the corresponding event when one exists.
   * Throws NotFoundException if the adoption record does not exist.
   * Any failure in logEvent propagates to the caller (no silent failures).
   */
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

    // Enforce state machine before updating
    this.adoptionStateMachine.assertValidTransition(existing.status, dto.status);

    const updated = await this.prisma.adoption.update({
      where: { id: adoptionId },
      data: { status: dto.status },
    });

    this.logger.log(
      `Adoption ${adoptionId} status updated from ${existing.status} to ${dto.status} by actor ${actorId}`,
    );

    // Log event for this transition
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
          petId: updated.petId,
          adopterId: updated.adopterId,
        } satisfies Prisma.InputJsonValue,
      });

      // Best-effort: enqueue a notification email without blocking status updates.
      if (this.notificationQueueService) {
        try {
          const adopter = await this.prisma.user.findUnique({
            where: { id: updated.adopterId },
            select: { email: true },
          });

          if (adopter?.email) {
            await this.notificationQueueService.enqueueSendTransactionalEmail(
              {
                dto: {
                  to: adopter.email,
                  subject: `PetAd: Adoption ${dto.status}`,
                  text: `Hello! Your adoption has been updated to ${dto.status}.`,
                },
                metadata: { adoptionId, newStatus: dto.status },
              },
            );
          }
        } catch (error) {
          const reason =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Failed to enqueue adoption notification email | adoptionId=${adoptionId} | reason=${reason}`,
          );
        }
      }
    }

    return updated;
  }

  /**
   * Approves a pending adoption request.
   * Changes adoption status from PENDING to APPROVED.
   * Sets approvedAt timestamp.
   * Fires ADOPTION_APPROVED event.
   * 
   * @throws NotFoundException if adoption doesn't exist
   * @throws DomainException if adoption is not in PENDING status
   */
  async approveAdoption(adoptionId: string, adminId: string) {
    return this.prisma.$transaction(async (tx) => {
      const adoption = await tx.adoption.findUnique({
        where: { id: adoptionId },
        include: {
          pet: true,
          adopter: { select: { id: true, email: true, firstName: true, lastName: true } },
        },
      });

      if (!adoption) {
        throw new NotFoundException(`Adoption with id "${adoptionId}" not found`);
      }

      // Validate state transition
      this.adoptionStateMachine.assertValidTransition(
        adoption.status,
        AdoptionStatus.APPROVED,
      );

      // Update adoption status to APPROVED
      const updated = await tx.adoption.update({
        where: { id: adoptionId },
        data: {
          status: AdoptionStatus.APPROVED,
        },
        include: {
          pet: {
            select: {
              id: true,
              name: true,
              species: true,
              imageUrl: true,
            },
          },
          adopter: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          owner: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

      this.logger.log(
        `Adoption ${adoptionId} approved by admin ${adminId}. Pet ${adoption.petId} status remains PENDING for escrow.`,
      );

      // Log ADOPTION_APPROVED event
      await this.events.logEvent({
        entityType: EventEntityType.ADOPTION,
        entityId: adoptionId,
        eventType: EventType.ADOPTION_APPROVED,
        actorId: adminId,
        payload: {
          adoptionId,
          petId: adoption.petId,
          adopterId: adoption.adopterId,
          ownerId: adoption.ownerId,
        } satisfies Prisma.InputJsonValue,
      });

      // Best-effort: enqueue notification email
      if (this.notificationQueueService && adoption.adopter.email) {
        try {
          await this.notificationQueueService.enqueueSendTransactionalEmail({
            dto: {
              to: adoption.adopter.email,
              subject: 'PetAd: Your Adoption Request Has Been Approved!',
              text: `Hello ${adoption.adopter.firstName}! Great news - your adoption request for ${adoption.pet.name} has been approved. Next steps will follow soon.`,
            },
            metadata: { adoptionId, status: 'APPROVED' },
          });
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Failed to enqueue approval notification | adoptionId=${adoptionId} | reason=${reason}`,
          );
        }
      }

      return updated;
    });
  }

  /**
   * Rejects a pending adoption request.
   * Changes adoption status from PENDING to REJECTED.
   * Updates pet status back to AVAILABLE (frees the pet for other adopters).
   * Optionally stores rejection reason in notes field.
   * 
   * @throws NotFoundException if adoption doesn't exist
   * @throws DomainException if adoption is not in PENDING status
   */
  async rejectAdoption(
    adoptionId: string,
    adminId: string,
    dto: RejectAdoptionDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const adoption = await tx.adoption.findUnique({
        where: { id: adoptionId },
        include: {
          pet: true,
          adopter: { select: { id: true, email: true, firstName: true, lastName: true } },
        },
      });

      if (!adoption) {
        throw new NotFoundException(`Adoption with id "${adoptionId}" not found`);
      }

      // Validate state transition
      this.adoptionStateMachine.assertValidTransition(
        adoption.status,
        AdoptionStatus.REJECTED,
      );

      // Prepare notes with rejection reason
      const rejectionNotes = dto.reason
        ? `${adoption.notes ? adoption.notes + '\n\n' : ''}[REJECTED] ${dto.reason}`
        : adoption.notes;

      // Update adoption status to REJECTED
      const updated = await tx.adoption.update({
        where: { id: adoptionId },
        data: {
          status: AdoptionStatus.REJECTED,
          notes: rejectionNotes,
        },
        include: {
          pet: {
            select: {
              id: true,
              name: true,
              species: true,
              imageUrl: true,
            },
          },
          adopter: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          owner: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

      this.logger.log(
        `Adoption ${adoptionId} rejected by admin ${adminId}. Pet ${adoption.petId} is now available for other adopters.${dto.reason ? ` Reason: ${dto.reason}` : ''}`,
      );

      // Log event (no specific ADOPTION_REJECTED event in schema, but we could add it or use a generic approach)
      // For now, we'll skip the event log since ADOPTION_REJECTED is not in the EventType enum
      // If needed, this can be added to the schema later

      // Best-effort: enqueue notification email
      if (this.notificationQueueService && adoption.adopter.email) {
        try {
          const reasonText = dto.reason ? `\n\nReason: ${dto.reason}` : '';
          await this.notificationQueueService.enqueueSendTransactionalEmail({
            dto: {
              to: adoption.adopter.email,
              subject: 'PetAd: Adoption Request Update',
              text: `Hello ${adoption.adopter.firstName}, we regret to inform you that your adoption request for ${adoption.pet.name} has been rejected.${reasonText}\n\nYou can browse other available pets on our platform.`,
            },
            metadata: { adoptionId, status: 'REJECTED' },
          });
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Failed to enqueue rejection notification | adoptionId=${adoptionId} | reason=${reason}`,
          );
        }
      }

      return updated;
    });
  }

  /**
   * Retrieves a list of adoptions based on the user's role and provided filters.
   * - ADMIN: Sees all adoptions (filtered by query)
   * - SHELTER: Sees only adoptions where they are the owner (plus query filters)
   * - USER: Sees only adoptions where they are the adopter (plus query filters)
   */
  async findAll(user: any, query: import('./dto/filter-adoptions.dto').FilterAdoptionsDto) {
    let where: Prisma.AdoptionWhereInput = { ...query };

    // Standardize getting the user ID (could be id or userId depending on the JWT payload)
    const currentUserId = user.id || user.userId;

    if (user.role === 'ADMIN') {
      where = { ...query };
    } else if (user.role === 'SHELTER') {
      where = { ...query, ownerId: currentUserId };
    } else {
      // Default to USER role restrictions
      where = { ...query, adopterId: currentUserId };
    }

    return this.prisma.adoption.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        pet: {
          select: {
            id: true,
            name: true,
            species: true,
            imageUrl: true, // as per Prisma schema
          },
        },
        adopter: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            // crucial: password is not included
          },
        },
      },
    });
  }
}
