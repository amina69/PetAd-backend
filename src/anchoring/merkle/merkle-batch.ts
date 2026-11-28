import { createHash } from 'crypto';

export interface MerkleBatchRecord {
  fromPosition: number;
  toPosition: number;
  leafCount: number;
  root: string;
  leaves: string[];
}

export class MerkleBatchBuilder {
  /**
   * Hashes a leaf with the 0x00 domain separation prefix.
   */
  public static hashLeaf(leaf: string): string {
    const hash = createHash('sha256');
    // 0x00 prefix + leaf data (assuming hex or utf8 string; if hex string, parse buffer, else utf8)
    const dataBuffer = Buffer.from(leaf, 'hex').length * 2 === leaf.length && /^[0-9a-fA-F]+$/.test(leaf)
      ? Buffer.from(leaf, 'hex')
      : Buffer.from(leaf, 'utf8');
    
    const prefixed = Buffer.concat([
      Buffer.from([0x00]),
      dataBuffer,
    ]);
    hash.update(prefixed);
    return hash.digest('hex');
  }

  /**
   * Hashes an internal node with the 0x01 domain separation prefix.
   */
  public static hashNode(leftHex: string, rightHex: string): string {
    const hash = createHash('sha256');
    const leftBuf = Buffer.from(leftHex, 'hex');
    const rightBuf = Buffer.from(rightHex, 'hex');
    const prefixed = Buffer.concat([
      Buffer.from([0x01]),
      leftBuf,
      rightBuf,
    ]);
    hash.update(prefixed);
    return hash.digest('hex');
  }

  /**
   * Builds a Merkle batch record from an ordered list of leaf hashes/events
   * along with their global positions.
   */
  public static buildBatch(leaves: string[], fromPosition: number, toPosition: number): MerkleBatchRecord {
    if (leaves.length === 0) {
      throw new Error('Cannot build Merkle tree from empty leaves');
    }

    // Hash all leaves with 0x00 prefix
    let currentLevel = leaves.map((leaf) => this.hashLeaf(leaf));

    while (currentLevel.length > 1) {
      const nextLevel: string[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        if (i + 1 < currentLevel.length) {
          nextLevel.push(this.hashNode(currentLevel[i], currentLevel[i + 1]));
        } else {
          // Odd-leaf rule: promote without duplicating
          nextLevel.push(currentLevel[i]);
        }
      }
      currentLevel = nextLevel;
    }

    return {
      fromPosition,
      toPosition,
      leafCount: leaves.length,
      root: currentLevel[0],
      leaves,
    };
  }
}
