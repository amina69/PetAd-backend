import { AnchoringService } from './anchoring.service';
import { AnchorBatchRepository } from './anchor-batch.repository';
import { FakeAnchorGateway } from './gateways/fake-anchor.gateway';
import { buildMerkleTree, createMerkleProof, sha256Hex } from './merkle';

describe('AnchoringService verification', () => {
  const leaves = ['e1', 'e2', 'e3'].map((value) => sha256Hex(value));
  const tree = buildMerkleTree(leaves);

  const repository = {
    findLeafByEventHash: jest.fn().mockResolvedValue(null),
  };

  let gateway: FakeAnchorGateway;
  let service: AnchoringService;

  beforeEach(() => {
    jest.clearAllMocks();
    gateway = new FakeAnchorGateway();
    service = new AnchoringService(
      repository as unknown as AnchorBatchRepository,
      gateway,
    );
  });

  it('returns valid=true for a genuine proof against the on-chain root', async () => {
    const submission = await gateway.submitRoot(tree.root);

    const result = await service.verifyProof({
      eventHash: leaves[1],
      proof: createMerkleProof(leaves, 1),
      merkleRoot: tree.root,
      txHash: submission.txHash,
    });

    expect(result).toEqual({
      valid: true,
      anchoredAt: expect.any(String) as string,
      txHash: submission.txHash,
      explorerUrl: submission.explorerUrl,
    });
  });

  it('returns valid=false for a tampered proof', async () => {
    const submission = await gateway.submitRoot(tree.root);
    const proof = createMerkleProof(leaves, 1).map((step, index) =>
      index === 0 ? { ...step, hash: sha256Hex('tampered') } : step,
    );

    const result = await service.verifyProof({
      eventHash: leaves[1],
      proof,
      merkleRoot: tree.root,
      txHash: submission.txHash,
    });

    expect(result.valid).toBe(false);
    expect(result.anchoredAt).toBeNull();
  });

  it('does not leak event payload data in the response', async () => {
    const submission = await gateway.submitRoot(tree.root);

    const result = await service.verifyProof({
      eventHash: leaves[0],
      proof: createMerkleProof(leaves, 0),
      merkleRoot: tree.root,
      txHash: submission.txHash,
    });

    expect(Object.keys(result).sort()).toEqual([
      'anchoredAt',
      'explorerUrl',
      'txHash',
      'valid',
    ]);
    expect(JSON.stringify(result)).not.toContain('payload');
  });

  it('returns valid=false when no anchor can be found', async () => {
    repository.findLeafByEventHash.mockResolvedValueOnce(null);

    const result = await service.verifyProof({
      eventHash: leaves[0],
      proof: createMerkleProof(leaves, 0),
      merkleRoot: tree.root,
    });

    expect(result.valid).toBe(false);
    expect(result.txHash).toBeNull();
    expect(result.explorerUrl).toBeNull();
  });
});
