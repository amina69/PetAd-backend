import { Injectable } from '@nestjs/common';
import {
  AnchorBatch,
  AnchorBatchLeaf,
  AnchorBatchStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AnchorBatchRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreateOpenBatch(): Promise<AnchorBatch> {
    const open = await this.prisma.anchorBatch.findFirst({
      where: { status: AnchorBatchStatus.OPEN },
      orderBy: { createdAt: 'asc' },
    });

    if (open) {
      return open;
    }

    return this.prisma.anchorBatch.create({
      data: { status: AnchorBatchStatus.OPEN },
    });
  }

  async findOldestOpenBatch(): Promise<AnchorBatch | null> {
    return this.prisma.anchorBatch.findFirst({
      where: { status: AnchorBatchStatus.OPEN },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findByEventLogId(eventLogId: string): Promise<AnchorBatchLeaf | null> {
    return this.prisma.anchorBatchLeaf.findUnique({
      where: { eventLogId },
    });
  }

  async findLeafByEventHash(eventHash: string): Promise<
    | (AnchorBatchLeaf & {
        batch: AnchorBatch;
      })
    | null
  > {
    return this.prisma.anchorBatchLeaf.findFirst({
      where: { eventHash: eventHash.toLowerCase() },
      include: { batch: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async appendLeaf(
    batchId: string,
    eventLogId: string,
    eventHash: string,
  ): Promise<AnchorBatchLeaf> {
    return this.prisma.$transaction(async (transaction) => {
      const batch = await transaction.anchorBatch.findUniqueOrThrow({
        where: { id: batchId },
      });

      const leaf = await transaction.anchorBatchLeaf.create({
        data: {
          batchId,
          eventLogId,
          eventHash: eventHash.toLowerCase(),
          leafIndex: batch.leafCount,
        },
      });

      await transaction.anchorBatch.update({
        where: { id: batchId },
        data: { leafCount: { increment: 1 } },
      });

      return leaf;
    });
  }

  async findBatchWithLeaves(
    batchId: string,
  ): Promise<(AnchorBatch & { leaves: AnchorBatchLeaf[] }) | null> {
    return this.prisma.anchorBatch.findUnique({
      where: { id: batchId },
      include: { leaves: { orderBy: { leafIndex: 'asc' } } },
    });
  }

  async setMerkleRoot(
    batchId: string,
    merkleRoot: string,
    leafCount: number,
  ): Promise<AnchorBatch> {
    return this.prisma.anchorBatch.update({
      where: { id: batchId },
      data: { merkleRoot: merkleRoot.toLowerCase(), leafCount },
    });
  }

  async markSubmitted(
    batchId: string,
    txHash: string,
    submittedAt: Date,
  ): Promise<AnchorBatch> {
    return this.prisma.anchorBatch.update({
      where: { id: batchId },
      data: {
        status: AnchorBatchStatus.SUBMITTED,
        txHash,
        submittedAt,
      },
    });
  }

  async markDisputed(batchId: string, reason: string): Promise<AnchorBatch> {
    return this.prisma.anchorBatch.update({
      where: { id: batchId },
      data: {
        status: AnchorBatchStatus.DISPUTED,
        disputeReason: reason,
      },
    });
  }

  async markFailed(batchId: string, reason: string): Promise<AnchorBatch> {
    return this.prisma.anchorBatch.update({
      where: { id: batchId },
      data: {
        status: AnchorBatchStatus.FAILED,
        disputeReason: reason,
      },
    });
  }

  /**
   * Marks a batch confirmed and stamps every included ledger event with the
   * transaction hash and block height in a single UPDATE statement.
   *
   * The batch update, event stamping and EVENTS_ANCHORED ledger entry share
   * one database transaction.
   */
  async confirmBatch(params: {
    batchId: string;
    txHash: string;
    blockHeight: number;
    confirmedAt: Date;
    eventLogIds: string[];
    merkleRoot: string;
  }): Promise<void> {
    const {
      batchId,
      txHash,
      blockHeight,
      confirmedAt,
      eventLogIds,
      merkleRoot,
    } = params;

    await this.prisma.$transaction(async (transaction) => {
      await transaction.anchorBatch.update({
        where: { id: batchId },
        data: {
          status: AnchorBatchStatus.CONFIRMED,
          txHash,
          blockHeight,
          confirmedAt,
          disputeReason: null,
        },
      });

      if (eventLogIds.length > 0) {
        await transaction.eventLog.updateMany({
          where: { id: { in: eventLogIds } },
          data: { txHash, blockHeight, anchorBatchId: batchId },
        });
      }

      await transaction.eventLog.create({
        data: {
          entityType: 'ANCHOR',
          entityId: batchId,
          eventType: 'EVENTS_ANCHORED',
          txHash,
          blockHeight,
          payload: {
            batchId,
            merkleRoot,
            txHash,
            blockHeight,
            leafCount: eventLogIds.length,
          },
        },
      });
    });
  }

  async listSubmittedBatchIds(): Promise<string[]> {
    const batches = await this.prisma.anchorBatch.findMany({
      where: { status: AnchorBatchStatus.SUBMITTED },
      select: { id: true },
      orderBy: { submittedAt: 'asc' },
    });
    return batches.map((batch) => batch.id);
  }
}
