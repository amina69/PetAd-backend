import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { EscrowService } from '../escrow/escrow.service';
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
    @Optional()
    private readonly notificationQueueService?: NotificationQueueService,
  ) {}

  async createCustody(
    userId: string,
    dto: CreateCustodyDto,
  ): Promise<CustodyResponseDto> {
    const { petId, startDate, durationDays, depositAmount } = dto;

    // Validate pet exists
    const pet = await this.prisma.pet.findUnique({
      where: { id: petId },
    });

    if (!pet) {
      throw new NotFoundException(`Pet with id ${petId} not found`);
    }

    // Check if pet is adopted (has a completed adoption)
    const completedAdoption = await this.prisma.adoption.findFirst({
      where: {
        petId,
        status: 'COMPLETED',
      },
    });

    if (completedAdoption) {
      throw new BadRequestException('Pet is already adopted');
    }

    // Check if pet has an active adoption in progress
    const activeAdoption = await this.prisma.adoption.findFirst({
      where: {
        petId,
        status: {
          in: ['REQUESTED', 'PENDING', 'APPROVED', 'ESCROW_FUNDED'],
        },
      },
    });

    if (activeAdoption) {
      throw new BadRequestException(
        'Pet has an active adoption in progress',
      );
    }

    // Check if pet has an active custody
    const activeCustody = await this.prisma.custody.findFirst({
      where: {
        petId,
        status: 'ACTIVE',
      },
    });

    if (activeCustody) {
      throw new BadRequestException(
        'Pet already has an active custody agreement',
      );
    }

    // Validate startDate is not in the past
    const now = new Date();
    now.setHours(0, 0, 0, 0); // Set to start of day for comparison
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);

    if (start < now) {
      throw new BadRequestException('Start date cannot be in the past');
    }

    // Validate durationDays range (1-90)
    if (durationDays < 1 || durationDays > 90) {
      throw new BadRequestException(
        'Duration must be between 1 and 90 days',
      );
    }

    // Calculate endDate
    const startDateObj = new Date(startDate);
    const endDate = new Date(startDateObj);
    endDate.setDate(endDate.getDate() + durationDays);

    // Create custody record with transaction
    // If depositAmount is provided, also create escrow
    const custody = await this.prisma.$transaction(async (tx) => {
      let escrowId: string | null = null;

      // Create escrow if deposit amount is provided
      if (depositAmount !== undefined && depositAmount !== null) {
        const escrow = await this.escrowService.createEscrow(
          depositAmount,
          tx,
        );
        escrowId = escrow.id;
      }

      // Create custody record
      const custodyRecord = await tx.custody.create({
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
        include: {
          pet: true,
        },
      });

      return custodyRecord;
    });

    // Log custody creation event
    await this.eventsService.logEvent({
      entityType: 'CUSTODY',
      entityId: custody.id,
      eventType: 'CUSTODY_STARTED',
      actorId: userId,
      payload: {
        petId: custody.petId,
        startDate: custody.startDate,
        endDate: custody.endDate,
        depositAmount: custody.depositAmount,
      },
    });

    // Best-effort: enqueue a notification email without blocking custody creation.
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
              subject: 'PetAd: Custody Agreement Started',
              text: `Hello! Your custody agreement has started for pet ${custody.petId}.`,
            },
            metadata: { custodyId: custody.id, petId: custody.petId },
          });
        }
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : String(error);
        // Intentionally using Nest logger semantics; don't fail request due to async email.
        // eslint-disable-next-line no-console
        console.error(
          `Failed to enqueue custody notification email | custodyId=${custody.id} | reason=${reason}`,
        );
      }
    }

    return custody as CustodyResponseDto;
  }
}
