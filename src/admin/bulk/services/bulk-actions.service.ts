import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DocumentVerificationStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { LoggingService } from '../../../logging/logging.service';
import { AdoptionService } from '../../../adoption/adoption.service';
import {
  ALLOWED_BULK_ACTIONS,
  BulkAction,
  BulkActionDto,
  BulkResource,
} from '../dto/bulk-action.dto';
import {
  BulkActionResponseDto,
  BulkActionResultDto,
} from '../dto/bulk-action-result.dto';

const RESOURCE_LABEL: Record<BulkResource, string> = {
  [BulkResource.ADOPTIONS]: 'ADOPTION',
  [BulkResource.DOCUMENTS]: 'DOCUMENT',
  [BulkResource.PETS]: 'PET',
};

@Injectable()
export class BulkActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adoptionService: AdoptionService,
    private readonly loggingService: LoggingService,
  ) {}

  async execute(
    resource: BulkResource,
    action: BulkAction,
    dto: BulkActionDto,
    actorId: string,
  ): Promise<BulkActionResponseDto> {
    if (!ALLOWED_BULK_ACTIONS[resource].includes(action)) {
      throw new BadRequestException(
        `Action "${action}" is not supported for "${resource}"`,
      );
    }

    const results: BulkActionResultDto[] = [];

    for (const id of dto.ids) {
      try {
        await this.applyOne(resource, action, id, dto.reason, actorId);
        await this.audit(resource, action, id, dto.reason, actorId, true);
        results.push({ id, success: true });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(error ?? 'Unknown error');
        await this.audit(
          resource,
          action,
          id,
          dto.reason,
          actorId,
          false,
          message,
        );
        results.push({ id, success: false, error: message });
      }
    }

    return {
      results,
      succeeded: results.filter((result) => result.success).length,
      failed: results.filter((result) => !result.success).length,
    };
  }

  private async applyOne(
    resource: BulkResource,
    action: BulkAction,
    id: string,
    reason: string,
    actorId: string,
  ): Promise<void> {
    switch (resource) {
      case BulkResource.ADOPTIONS:
        if (action === BulkAction.APPROVE) {
          await this.adoptionService.approveAdoption(id, actorId);
          return;
        }
        if (action === BulkAction.REJECT) {
          await this.adoptionService.rejectAdoption(id, actorId, { reason });
          return;
        }
        break;

      case BulkResource.DOCUMENTS:
        if (action === BulkAction.VERIFY) {
          const document = await this.prisma.document.findUnique({
            where: { id },
          });
          if (!document) {
            throw new NotFoundException(`Document "${id}" not found`);
          }
          if (
            document.verificationStatus !== DocumentVerificationStatus.PENDING
          ) {
            throw new ConflictException(
              `Document "${id}" is already ${document.verificationStatus}`,
            );
          }
          await this.prisma.document.update({
            where: { id },
            data: {
              verificationStatus: DocumentVerificationStatus.VERIFIED,
              verifiedAt: new Date(),
              verifiedById: actorId,
              verificationReason: reason,
            },
          });
          return;
        }
        break;

      case BulkResource.PETS:
        if (action === BulkAction.ARCHIVE) {
          const pet = await this.prisma.pet.findUnique({ where: { id } });
          if (!pet) {
            throw new NotFoundException(`Pet "${id}" not found`);
          }
          if (pet.archivedAt) {
            throw new ConflictException(`Pet "${id}" is already archived`);
          }
          await this.prisma.pet.update({
            where: { id },
            data: {
              archivedAt: new Date(),
              archiveReason: reason,
            },
          });
          return;
        }
        break;
    }

    throw new BadRequestException(
      `Action "${action}" is not supported for "${resource}"`,
    );
  }

  private async audit(
    resource: BulkResource,
    action: BulkAction,
    itemId: string,
    reason: string,
    actorId: string,
    success: boolean,
    error?: string,
  ): Promise<void> {
    await this.loggingService.log({
      level: success ? 'INFO' : 'WARN',
      action: `BULK_${RESOURCE_LABEL[resource]}_${action.toUpperCase()}_${success ? 'SUCCEEDED' : 'FAILED'}`,
      message: `Bulk ${action} of ${resource} item ${itemId} ${success ? 'succeeded' : `failed: ${error}`}`,
      userId: actorId,
      metadata: {
        resource,
        action,
        itemId,
        reason,
        success,
        ...(error ? { error } : {}),
      },
    });
  }
}
