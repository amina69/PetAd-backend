import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AnchorBatch } from '@prisma/client';
import { AnchorBatchRepository } from './anchor-batch.repository';
import {
  ANCHOR_GATEWAY,
  type AnchorGateway,
  type OnChainAnchor,
} from './gateways/anchor.gateway';
import {
  buildMerkleTree,
  createMerkleProof,
  hashLedgerEvent,
  type LedgerEventForHash,
  type MerkleProofStep,
  verifyMerkleProof,
} from './merkle';

export interface AnchorProof {
  eventHash: string;
  batchId: string;
  merkleRoot: string;
  txHash: string | null;
  blockHeight: number | null;
  proof: MerkleProofStep[];
}

export interface VerifyProofInput {
  eventHash: string;
  proof: MerkleProofStep[];
  merkleRoot?: string;
  txHash?: string;
}

export interface VerifyProofResult {
  valid: boolean;
  anchoredAt: string | null;
  txHash: string | null;
  explorerUrl: string | null;
}

const VERIFY_CACHE_TTL_MS = 60_000;

interface CachedVerification {
  expiresAt: number;
  result: VerifyProofResult;
}

/**
 * Builds anchoring batches and produces/verifies Merkle inclusion proofs.
 *
 * Event payloads are never part of a proof or a verification response; the
 * public contract only carries the event hash, the path and chain metadata.
 */
@Injectable()
export class AnchoringService {
  private readonly logger = new Logger(AnchoringService.name);
  private readonly verificationCache = new Map<string, CachedVerification>();

  constructor(
    private readonly repository: AnchorBatchRepository,
    @Inject(ANCHOR_GATEWAY) private readonly gateway: AnchorGateway,
  ) {}

  /** Adds a freshly appended ledger event to the current open batch. */
  async addEventToBatch(event: LedgerEventForHash): Promise<void> {
    const existing = await this.repository.findByEventLogId(event.id);
    if (existing) {
      return;
    }

    const batch = await this.repository.getOrCreateOpenBatch();
    const eventHash = hashLedgerEvent(event);

    try {
      await this.repository.appendLeaf(batch.id, event.id, eventHash);
    } catch (error) {
      // Concurrent appends cannot both insert the same event; a duplicate is
      // already anchored and is not an error.
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not add event ${event.id} to batch: ${reason}`);
    }
  }

  /**
   * Computes and stores the Merkle root for an open batch.
   * Returns null when there is no open batch to seal.
   */
  async sealBatch(batchId?: string): Promise<AnchorBatch | null> {
    const batch = batchId
      ? await this.repository.findBatchWithLeaves(batchId)
      : await this.repository
          .findOldestOpenBatch()
          .then((open) =>
            open ? this.repository.findBatchWithLeaves(open.id) : null,
          );

    if (!batch) {
      return null;
    }

    if (batch.status !== 'OPEN' && batch.merkleRoot) {
      return batch;
    }

    if (batch.leaves.length === 0) {
      return batch;
    }

    const tree = buildMerkleTree(batch.leaves.map((leaf) => leaf.eventHash));
    return this.repository.setMerkleRoot(batch.id, tree.root, tree.leafCount);
  }

  /**
   * Seals (when needed) and submits a batch to the configured gateway.
   */
  async submitBatch(batchId?: string): Promise<AnchorBatch | null> {
    const sealed = await this.sealBatch(batchId);
    if (!sealed) {
      return null;
    }

    if (sealed.txHash) {
      return sealed;
    }

    if (!sealed.merkleRoot) {
      return sealed;
    }

    try {
      const submission = await this.gateway.submitRoot(sealed.merkleRoot);
      return this.repository.markSubmitted(
        sealed.id,
        submission.txHash,
        new Date(),
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Anchor submission failed for ${sealed.id}: ${reason}`);
      return this.repository.markFailed(sealed.id, reason);
    }
  }

  /** Returns the inclusion proof for an anchored or pending event hash. */
  async getProof(eventHash: string): Promise<AnchorProof> {
    const leaf = await this.repository.findLeafByEventHash(eventHash);
    if (!leaf) {
      throw new NotFoundException('No anchoring proof for this event hash');
    }

    const batch = await this.sealBatch(leaf.batchId);
    if (!batch || !batch.merkleRoot) {
      throw new NotFoundException(
        'The batch for this event has no Merkle root',
      );
    }

    const withLeaves = await this.repository.findBatchWithLeaves(batch.id);
    if (!withLeaves) {
      throw new NotFoundException('Anchoring batch not found');
    }

    const index = withLeaves.leaves.findIndex(
      (item) => item.eventLogId === leaf.eventLogId,
    );
    if (index < 0) {
      throw new NotFoundException('Event is not part of the batch');
    }

    return {
      eventHash: leaf.eventHash,
      batchId: withLeaves.id,
      merkleRoot: batch.merkleRoot,
      txHash: withLeaves.txHash,
      blockHeight: withLeaves.blockHeight,
      proof: createMerkleProof(
        withLeaves.leaves.map((item) => item.eventHash),
        index,
      ),
    };
  }

  /**
   * Recomputes the Merkle root from the supplied proof and compares it with
   * the value committed on chain. The result contains no event data.
   */
  async verifyProof(input: VerifyProofInput): Promise<VerifyProofResult> {
    const eventHash = input.eventHash.toLowerCase();
    const cacheKey = `${eventHash}:${input.txHash ?? ''}:${input.merkleRoot?.toLowerCase() ?? ''}:${JSON.stringify(input.proof)}`;
    const cached = this.verificationCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }

    const result = await this.computeVerification(eventHash, input);
    this.verificationCache.set(cacheKey, {
      expiresAt: Date.now() + VERIFY_CACHE_TTL_MS,
      result,
    });
    return result;
  }

  private async computeVerification(
    eventHash: string,
    input: VerifyProofInput,
  ): Promise<VerifyProofResult> {
    let txHash = input.txHash ?? null;
    let expectedRoot = input.merkleRoot?.toLowerCase() ?? null;

    if (!txHash || !expectedRoot) {
      const leaf = await this.repository.findLeafByEventHash(eventHash);
      if (leaf) {
        txHash = txHash ?? leaf.batch.txHash;
        expectedRoot =
          expectedRoot ?? leaf.batch.merkleRoot?.toLowerCase() ?? null;
      }
    }

    if (!txHash) {
      return this.invalidResult();
    }

    const proofValid =
      expectedRoot !== null &&
      verifyMerkleProof(eventHash, input.proof, expectedRoot);
    if (!proofValid) {
      return this.invalidResult(txHash);
    }

    let onChain: OnChainAnchor | null;
    try {
      onChain = await this.gateway.fetchRoot(txHash);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not fetch anchor ${txHash}: ${reason}`);
      return this.invalidResult(txHash);
    }

    if (!onChain || onChain.merkleRoot.toLowerCase() !== expectedRoot) {
      return this.invalidResult(txHash);
    }

    return {
      valid: true,
      anchoredAt: onChain.anchoredAt.toISOString(),
      txHash,
      explorerUrl: this.gateway.explorerUrl(txHash),
    };
  }

  private invalidResult(txHash: string | null = null): VerifyProofResult {
    return {
      valid: false,
      anchoredAt: null,
      txHash,
      explorerUrl: txHash ? this.gateway.explorerUrl(txHash) : null,
    };
  }
}
