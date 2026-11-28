import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';

export interface MerkleProofStep {
  hash: string;
  position: 'left' | 'right';
}

export interface EventProofResponse {
  eventHash: string;
  merkleRoot: string;
  path: MerkleProofStep[];
  batchId: string;
  txHash: string | null;
  ledger: string;
}

@Injectable()
export class ProofService {
  private batchCache = new Map<string, { root: string; leaves: string[]; proofMap: Map<string, MerkleProofStep[]> }>();

  constructor(private readonly prisma: PrismaService) {}

  private hashData(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  private computeLeafHash(event: any): string {
    const canonical = JSON.stringify({
      id: event.id,
      entityType: event.entityType,
      entityId: event.entityId,
      eventType: event.eventType,
      sequenceNumber: event.sequenceNumber,
      payload: event.payload,
    });
    return this.hashData(canonical);
  }

  private combineHash(left: string, right: string): string {
    return crypto.createHash('sha256').update(left + right).digest('hex');
  }

  public buildMerkleTree(leaves: string[]):
    | { root: string; proofMap: Map<string, MerkleProofStep[]> }
    | null {
    if (leaves.length === 0) return null;

    let currentLayer = leaves.map((leaf) => ({ hash: leaf, originalLeaf: leaf }));
    const proofs = new Map<string, MerkleProofStep[]>();
    for (const leaf of leaves) {
      proofs.set(leaf, []);
    }

    while (currentLayer.length > 1) {
      const nextLayer: Array<{ hash: string; originalLeaf: string }> = [];

      for (let i = 0; i < currentLayer.length; i += 2) {
        const left = currentLayer[i];
        const right = i + 1 < currentLayer.length ? currentLayer[i + 1] : left;
        const parentHash = this.combineHash(left.hash, right.hash);

        // Append proof steps for all leaves under left/right
        if (i + 1 < currentLayer.length) {
          // normal pair
          // For elements under left, sibling is right on the right
          // For elements under right, sibling is left on the left
          // To propagate correctly, we track subset of leaves or build per-leaf recursively.
        }

        nextLayer.push({ hash: parentHash, originalLeaf: left.originalLeaf });
      }
      currentLayer = nextLayer;
    }

    // Standard binary tree recursive path generation for absolute correctness
    return this.generateTreeAndProofs(leaves);
  }

  private generateTreeAndProofs(leaves: string[]): {
    root: string;
    proofMap: Map<string, MerkleProofStep[]>;
  } {
    if (leaves.length === 0) {
      return { root: '', proofMap: new Map() };
    }
    if (leaves.length === 1) {
      const proofs = new Map<string, MerkleProofStep[]>();
      proofs.set(leaves[0], []);
      return { root: leaves[0], proofMap: proofs };
    }

    let level: string[] = [...leaves];
    const nodeMap = new Map<string, string[]>();
    for (const l of leaves) {
      nodeMap.set(l, []);
    }

    // Build levels and record paths
    // Let's implement standard pairwise reduction collecting paths
    const treeLayers: string[][] = [leaves];
    while (treeLayers[treeLayers.length - 1].length > 1) {
      const prev = treeLayers[treeLayers.length - 1];
      const next: string[] = [];
      for (let i = 0; i < prev.length; i += 2) {
        const l = prev[i];
        const r = i + 1 < prev.length ? prev[i + 1] : l;
        next.push(this.combineHash(l, r));
      }
      treeLayers.push(next);
    }

    const proofs = new Map<string, MerkleProofStep[]>();
    for (let i = 0; i < leaves.length; i++) {
      const leaf = leaves[i];
      const path: MerkleProofStep[] = [];
      let index = i;
      for (let layerIdx = 0; layerIdx < treeLayers.length - 1; layerIdx++) {
        const layer = treeLayers[layerIdx];
        const isRight = index % 2 === 1;
        const siblingIndex = isRight ? index - 1 : index + 1;
        if (siblingIndex < layer.length) {
          path.push({
            hash: layer[siblingIndex],
            position: isRight ? 'left' : 'right',
          });
        } else {
          path.push({
            hash: layer[index],
            position: 'right',
          });
        }
        index = Math.floor(index / 2);
      }
      proofs.set(leaf, path);
    }

    const root = treeLayers[treeLayers.length - 1][0];
    return { root, proofMap: proofs };
  }

  async getProofForEvent(eventId: string): Promise<EventProofResponse> {
    const event = await (this.prisma.eventLog as any).findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    if (!event.anchorBatchId) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'NOT_YET_ANCHORED',
        message: 'Event is pending anchoring',
        etaHintSeconds: 300,
      });
    }

    const batchId = event.anchorBatchId;

    if (this.batchCache.has(batchId)) {
      const cached = this.batchCache.get(batchId)!;
      const leafHash = this.computeLeafHash(event);
      const path = cached.proofMap.get(leafHash);
      if (path) {
        return {
          eventHash: leafHash,
          merkleRoot: cached.root,
          path,
          batchId,
          txHash: event.txHash || null,
          ledger: 'Stellar',
        };
      }
    }

    const batchEvents = await (this.prisma.eventLog as any).findMany({
      where: { anchorBatchId: batchId },
      orderBy: { createdAt: 'asc' },
    });

    const leaves = batchEvents.map((e: any) => this.computeLeafHash(e));
    const { root, proofMap } = this.generateTreeAndProofs(leaves);

    this.batchCache.set(batchId, { root, leaves, proofMap });

    const leafHash = this.computeLeafHash(event);
    const path = proofMap.get(leafHash) || [];

    return {
      eventHash: leafHash,
      merkleRoot: root,
      path,
      batchId,
      txHash: event.txHash || null,
      ledger: 'Stellar',
    };
  }

  public verifyProof(
    leafHash: string,
    merkleRoot: string,
    path: MerkleProofStep[],
  ): boolean {
    let current = leafHash;
    for (const step of path) {
      if (step.position === 'left') {
        current = this.combineHash(step.hash, current);
      } else {
        current = this.combineHash(current, step.hash);
      }
    }
    return current === merkleRoot;
  }
}
