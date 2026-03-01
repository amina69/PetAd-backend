import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
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

    const updated = await this.prisma.adoption.update({
      where: { id: adoptionId },
      data: { status: dto.status },
    });

    this.logger.log(
      `Adoption ${adoptionId} status updated to ${dto.status} by actor ${actorId}`,
    );

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
    }

    return updated;
  }
}
