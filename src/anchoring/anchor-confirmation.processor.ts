import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { AnchorBatchRepository } from './anchor-batch.repository';
import {
  ANCHOR_GATEWAY,
  type AnchorGateway,
  type OnChainAnchor,
} from './gateways/anchor.gateway';
import { LoggingService } from '../logging/logging.service';

export type AnchorConfirmationStatus =
  | 'CONFIRMED'
  | 'DISPUTED'
  | 'PENDING'
  | 'FAILED';

export interface AnchorConfirmationResult {
  batchId: string;
  status: AnchorConfirmationStatus;
  txHash: string | null;
  blockHeight: number | null;
  reason?: string;
}

/**
 * Confirmation monitoring for anchored batches.
 *
 * On success the batch becomes CONFIRMED, every included ledger event gets
 * the transaction hash and block height, and an EVENTS_ANCHORED entry is
 * appended. If the stored Merkle root differs from Horizon, the batch is
 * marked DISPUTED and a critical alert is raised.
 */
@Injectable()
export class AnchorConfirmationProcessor {
  private readonly logger = new Logger(AnchorConfirmationProcessor.name);

  constructor(
    private readonly repository: AnchorBatchRepository,
    @Inject(ANCHOR_GATEWAY) private readonly gateway: AnchorGateway,
    @Optional() private readonly loggingService?: LoggingService,
  ) {}

  async process(batchId: string): Promise<AnchorConfirmationResult> {
    const batch = await this.repository.findBatchWithLeaves(batchId);
    if (!batch) {
      throw new NotFoundException('Anchoring batch not found');
    }

    if (batch.status === 'CONFIRMED') {
      return {
        batchId,
        status: 'CONFIRMED',
        txHash: batch.txHash,
        blockHeight: batch.blockHeight,
      };
    }

    if (batch.status === 'DISPUTED') {
      return {
        batchId,
        status: 'DISPUTED',
        txHash: batch.txHash,
        blockHeight: batch.blockHeight,
        reason: batch.disputeReason ?? undefined,
      };
    }

    if (!batch.txHash) {
      return {
        batchId,
        status: 'PENDING',
        txHash: null,
        blockHeight: null,
        reason: 'Batch has not been submitted',
      };
    }

    let onChain: OnChainAnchor | null;
    try {
      onChain = await this.gateway.fetchRoot(batch.txHash);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Could not check confirmation for batch ${batchId}: ${reason}`,
      );
      return {
        batchId,
        status: 'PENDING',
        txHash: batch.txHash,
        blockHeight: null,
        reason: 'Chain lookup failed; will retry',
      };
    }

    if (!onChain) {
      return {
        batchId,
        status: 'PENDING',
        txHash: batch.txHash,
        blockHeight: null,
        reason: 'Transaction not found on chain yet',
      };
    }

    const storedRoot = batch.merkleRoot?.toLowerCase() ?? null;
    if (!storedRoot || storedRoot !== onChain.merkleRoot.toLowerCase()) {
      const reason =
        `Stored Merkle root ${storedRoot ?? '(missing)'} does not match ` +
        `on-chain root ${onChain.merkleRoot}`;

      await this.repository.markDisputed(batchId, reason);
      await this.raiseCriticalAlert(
        batchId,
        batch.txHash,
        storedRoot,
        onChain.merkleRoot,
      );

      return {
        batchId,
        status: 'DISPUTED',
        txHash: batch.txHash,
        blockHeight: null,
        reason,
      };
    }

    await this.repository.confirmBatch({
      batchId,
      txHash: batch.txHash,
      blockHeight: onChain.blockHeight,
      confirmedAt: onChain.anchoredAt,
      eventLogIds: batch.leaves.map((leaf) => leaf.eventLogId),
      merkleRoot: onChain.merkleRoot,
    });

    this.logger.log(
      `EVENTS_ANCHORED batch=${batchId} tx=${batch.txHash} block=${onChain.blockHeight} events=${batch.leaves.length}`,
    );

    return {
      batchId,
      status: 'CONFIRMED',
      txHash: batch.txHash,
      blockHeight: onChain.blockHeight,
    };
  }

  /** Called by the confirmation worker to sweep all submitted batches. */
  async processPending(): Promise<AnchorConfirmationResult[]> {
    const batchIds = await this.repository.listSubmittedBatchIds();
    const results: AnchorConfirmationResult[] = [];
    for (const batchId of batchIds) {
      results.push(await this.process(batchId));
    }
    return results;
  }

  private async raiseCriticalAlert(
    batchId: string,
    txHash: string,
    storedRoot: string | null,
    onChainRoot: string,
  ): Promise<void> {
    const message =
      `CRITICAL: anchoring root mismatch for batch ${batchId} ` +
      `(tx ${txHash}); stored=${storedRoot ?? 'missing'}, on-chain=${onChainRoot}`;

    this.logger.error(message);

    try {
      await this.loggingService?.log({
        level: 'ERROR',
        action: 'ANCHOR_ROOT_MISMATCH',
        message,
        metadata: {
          batchId,
          txHash,
          storedRoot,
          onChainRoot,
          severity: 'CRITICAL',
        },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to record anchoring alert: ${reason}`);
    }
  }
}
