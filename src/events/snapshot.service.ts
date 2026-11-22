import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventEntityType, Prisma } from '@prisma/client';
import * as crypto from 'crypto';

export interface AggregateSnapshotData {
  aggregateId: string;
  aggregateType: EventEntityType;
  seq: number;
  state: Record<string, unknown>;
  stateHash: string;
  reducerVersion: number;
}

@Injectable()
export class SnapshotService {
  private readonly logger = new Logger(SnapshotService.name);
  private readonly snapshotFrequency = 10;
  private readonly currentReducerVersion = 1;

  constructor(private readonly prisma: PrismaService) {}

  computeStateHash(state: Record<string, unknown>): string {
    const canonicalString = JSON.stringify(state, Object.keys(state).sort());
    return crypto.createHash('sha256').update(canonicalString).digest('hex');
  }

  async saveSnapshot(aggregateId: string, aggregateType: EventEntityType, seq: number, state: Record<string, unknown>): Promise<void> {
    const stateHash = this.computeStateHash(state);
    const prismaClient = this.prisma as any;
    if (!prismaClient.aggregateSnapshot) {
      return;
    }
    await prismaClient.aggregateSnapshot.upsert({
      where: {
        aggregateId_seq: {
          aggregateId,
          seq,
        },
      },
      update: {
        state: state as Prisma.InputJsonValue,
        stateHash,
        reducerVersion: this.currentReducerVersion,
      },
      create: {
        aggregateId,
        aggregateType,
        seq,
        state: state as Prisma.InputJsonValue,
        stateHash,
        reducerVersion: this.currentReducerVersion,
      },
    });
  }

  async getLatestValidSnapshot(aggregateId: string): Promise<AggregateSnapshotData | null> {
    const prismaClient = this.prisma as any;
    if (!prismaClient.aggregateSnapshot) {
      return null;
    }
    const snapshots = await prismaClient.aggregateSnapshot.findMany({
      where: { aggregateId },
      orderBy: { seq: 'desc' },
    });

    for (const snap of snapshots) {
      if (snap.reducerVersion !== this.currentReducerVersion) {
        continue;
      }
      const expectedHash = this.computeStateHash(snap.state as Record<string, unknown>);
      if (expectedHash === snap.stateHash) {
        return {
          aggregateId: snap.aggregateId,
          aggregateType: snap.aggregateType,
          seq: snap.seq,
          state: snap.state as Record<string, unknown>,
          stateHash: snap.stateHash,
          reducerVersion: snap.reducerVersion,
        };
      } else {
        this.logger.warn(`Corrupted snapshot detected and ignored for aggregate ${aggregateId} at seq ${snap.seq}`);
      }
    }

    return null;
  }

  async maybeSnapshot(aggregateId: string, aggregateType: EventEntityType, seq: number, state: Record<string, unknown>): Promise<void> {
    if (seq > 0 && seq % this.snapshotFrequency === 0) {
      await this.saveSnapshot(aggregateId, aggregateType, seq, state);
    }
  }
}
