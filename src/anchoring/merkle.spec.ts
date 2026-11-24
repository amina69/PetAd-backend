import {
  buildMerkleTree,
  canonicalJson,
  createMerkleProof,
  hashLedgerEvent,
  sha256Hex,
  verifyMerkleProof,
} from './merkle';

describe('Merkle anchoring', () => {
  const leaves = ['a', 'b', 'c', 'd', 'e'].map((value) =>
    sha256Hex(`event-${value}`),
  );

  it('builds a deterministic 32-byte root', () => {
    const first = buildMerkleTree(leaves);
    const second = buildMerkleTree([...leaves]);

    expect(first.root).toMatch(/^[a-f0-9]{64}$/);
    expect(first.root).toBe(second.root);
    expect(first.leafCount).toBe(5);
  });

  it('verifies an inclusion proof for every leaf, including odd counts', () => {
    const tree = buildMerkleTree(leaves);

    leaves.forEach((leaf, index) => {
      const proof = createMerkleProof(leaves, index);
      expect(verifyMerkleProof(leaf, proof, tree.root)).toBe(true);
    });
  });

  it('rejects a tampered proof', () => {
    const tree = buildMerkleTree(leaves);
    const proof = createMerkleProof(leaves, 1);
    const tampered = proof.map((step, index) =>
      index === 0 ? { ...step, hash: sha256Hex('tampered') } : step,
    );

    expect(verifyMerkleProof(leaves[1], tampered, tree.root)).toBe(false);
  });

  it('rejects a proof for a different leaf', () => {
    const tree = buildMerkleTree(leaves);
    const proof = createMerkleProof(leaves, 0);

    expect(verifyMerkleProof(leaves[1], proof, tree.root)).toBe(false);
  });

  it('hashes events independently of payload key order', () => {
    const event = {
      id: 'evt-1',
      entityType: 'PET',
      entityId: 'pet-1',
      eventType: 'PET_REGISTERED',
      actorId: null,
      payload: { name: 'Buddy', species: 'DOG' },
      createdAt: new Date('2026-11-24T10:00:00.000Z'),
    };

    const reordered = {
      ...event,
      payload: { species: 'DOG', name: 'Buddy' },
    };

    expect(hashLedgerEvent(event)).toBe(hashLedgerEvent(reordered));
    expect(hashLedgerEvent(event)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('canonicalises nested values', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, null] } })).toBe(
      '{"a":{"c":[3,null],"d":2},"b":1}',
    );
  });
});
