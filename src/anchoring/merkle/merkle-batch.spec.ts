import { describe, it, expect } from '@jest/globals';
import { MerkleBatchBuilder } from './merkle-batch';

describe('MerkleBatchBuilder', () => {
  it('produces deterministic roots for the same range', () => {
    const leaves = ['hash1', 'hash2', 'hash3', 'hash4'];
    const batch1 = MerkleBatchBuilder.buildBatch(leaves, 1, 4);
    const batch2 = MerkleBatchBuilder.buildBatch(leaves, 1, 4);

    expect(batch1.root).toBe(batch2.root);
    expect(batch1.fromPosition).toBe(1);
    expect(batch1.toPosition).toBe(4);
    expect(batch1.leafCount).toBe(4);
  });

  it('generates golden test vectors for 1, 2, 3, 7, and 8 leaves', () => {
    const allLeaves = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

    const counts = [1, 2, 3, 7, 8];
    const roots = counts.map((count) => {
      const subset = allLeaves.slice(0, count);
      const batch = MerkleBatchBuilder.buildBatch(subset, 1, count);
      return { count, root: batch.root };
    });

    // Ensure deterministic roots are computed and non-empty for all golden vector counts
    expect(roots).toHaveLength(5);
    roots.forEach((r) => {
      expect(typeof r.root).toBe('string');
      expect(r.root.length).toBe(64); // SHA-256 hex length
    });

    // Verify same range always produces the same root
    const repeat1 = MerkleBatchBuilder.buildBatch(allLeaves.slice(0, 3), 1, 3);
    const repeat2 = MerkleBatchBuilder.buildBatch(allLeaves.slice(0, 3), 1, 3);
    expect(repeat1.root).toBe(repeat2.root);
  });
});
