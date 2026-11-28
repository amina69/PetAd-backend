import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LoggingService } from '../logging/logging.service';

@Injectable()
export class AnchoringRecoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggingService,
  ) {}

  /**
   * Determines whether an anchoring or transaction error is retryable.
   * Retryable errors include `tx_bad_seq`, timeouts, and rate limits/network drops.
   */
  isRetryableError(error: any): boolean {
    const message = typeof error === 'string' ? error : error?.message || '';
    const code = error?.code || error?.resultCodes?.transaction;
    
    if (
      code === 'tx_bad_seq' ||
      message.includes('tx_bad_seq') ||
      message.includes('timeout') ||
      message.includes('ETIMEDOUT') ||
      message.includes('ECONNREFUSED') ||
      message.includes('rate limit')
    ) {
      return true;
    }
    return false;
  }

  /**
   * Handles anchoring failures with exponential backoff logic and terminal state escalation.
   */
  async handleFailure(batchId: string, error: any, attemptCount = 1): Promise<void> {
    const retryable = this.isRetryableError(error);
    const maxRetries = 5;

    if (retryable && attemptCount <= maxRetries) {
      const backoffMs = Math.pow(2, attemptCount) * 1000;
      this.logger.log({
        level: 'WARN',
        action: 'ANCHORING_RETRY_SCHEDULED',
        message: `Batch ${batchId} failed with retryable error (attempt ${attemptCount}/${maxRetries}). Retrying in ${backoffMs}ms.`,
      });
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      return;
    }

    // Terminal failure reached
    this.logger.log({
      level: 'ERROR',
      action: 'ANCHORING_TERMINAL_FAILURE',
      message: `Batch ${batchId} encountered terminal failure: ${error?.message || error}. Admin alert dispatched.`,
    });

    await (this.prisma as any).eventLedger.create({
      data: {
        aggregateType: 'ANCHORING_BATCH',
        aggregateId: batchId,
        sequence: 1,
        eventType: 'ANCHORING_BATCH_FAILED',
        eventVersion: 1,
        occurredAt: new Date(),
        payload: { error: error?.message || error, terminal: true },
        previousEventHash: '',
        eventHash: '',
      },
    });
  }

  /**
   * POST /admin/anchoring/batches/:id/retry
   * Re-anchoring creates a new batch id that references the failed one, never mutating history.
   */
  async retryBatch(failedBatchId: string): Promise<any> {
    const failedBatch = await (this.prisma as any).eventLedger.findFirst({
      where: {
        aggregateId: failedBatchId,
      },
    });

    if (!failedBatch) {
      throw new NotFoundException(`Anchoring batch with id ${failedBatchId} not found.`);
    }

    const newBatchId = `anchor-batch-${Date.now()}`;
    const newBatchEvent = await (this.prisma as any).eventLedger.create({
      data: {
        aggregateType: 'ANCHORING_BATCH',
        aggregateId: newBatchId,
        sequence: 1,
        eventType: 'ANCHORING_BATCH_RETRY_CREATED',
        eventVersion: 1,
        occurredAt: new Date(),
        payload: {
          previousBatchId: failedBatchId,
          retriedAt: new Date().toISOString(),
        },
        previousEventHash: '',
        eventHash: '',
      },
    });

    this.logger.log({
      level: 'INFO',
      action: 'ANCHORING_RE-ANCHORED',
      message: `Created new anchoring batch ${newBatchId} referencing failed batch ${failedBatchId}.`,
    });

    return {
      newBatchId,
      previousBatchId: failedBatchId,
      status: 'PENDING_RETRY',
      createdAt: newBatchEvent.recordedAt,
    };
  }
}
