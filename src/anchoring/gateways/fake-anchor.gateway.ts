import { Injectable } from '@nestjs/common';
import {
  type AnchorGateway,
  type AnchorSubmission,
  type OnChainAnchor,
} from './anchor.gateway';
import { sha256Hex } from '../merkle';

/**
 * In-memory anchoring gateway. It commits roots to a map instead of a chain,
 * so append → batch → submit → confirm → proof → verify can run end-to-end
 * without network access.
 */
@Injectable()
export class FakeAnchorGateway implements AnchorGateway {
  private readonly anchors = new Map<string, OnChainAnchor>();
  private counter = 0;

  submitRoot(merkleRoot: string): Promise<AnchorSubmission> {
    if (!/^[a-f0-9]{64}$/i.test(merkleRoot)) {
      return Promise.reject(
        new Error('Merkle root must be a 32-byte hex string'),
      );
    }

    this.counter += 1;
    const txHash = sha256Hex(
      `fake-anchor:${merkleRoot.toLowerCase()}:${this.counter}`,
    );
    this.anchors.set(txHash, {
      merkleRoot: merkleRoot.toLowerCase(),
      blockHeight: 1000 + this.counter,
      anchoredAt: new Date(),
    });

    return Promise.resolve({
      txHash,
      explorerUrl: this.explorerUrl(txHash),
    });
  }

  fetchRoot(txHash: string): Promise<OnChainAnchor | null> {
    return Promise.resolve(this.anchors.get(txHash) ?? null);
  }

  explorerUrl(txHash: string): string {
    return `https://stellar.expert/explorer/testnet/tx/${txHash}`;
  }

  /** Test helper: replace the committed root to simulate a chain mismatch. */
  tamperRoot(txHash: string, merkleRoot: string): void {
    const existing = this.anchors.get(txHash);
    if (existing) {
      this.anchors.set(txHash, { ...existing, merkleRoot });
    }
  }
}
