import { AnchorBatchRepository } from './anchor-batch.repository';
import { AnchorConfirmationProcessor } from './anchor-confirmation.processor';
import { FakeAnchorGateway } from './gateways/fake-anchor.gateway';
import { LoggingService } from '../logging/logging.service';
import { buildMerkleTree, sha256Hex } from './merkle';

const leaves = [sha256Hex('event-1'), sha256Hex('event-2')];
const tree = buildMerkleTree(leaves);

function batchWith(txHash: string) {
  return {
    id: 'batch-1',
    merkleRoot: tree.root,
    status: 'SUBMITTED',
    txHash,
    blockHeight: null,
    leafCount: leaves.length,
    submittedAt: new Date(),
    confirmedAt: null,
    disputeReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    leaves: leaves.map((eventHash, index) => ({
      id: `leaf-${index}`,
      batchId: 'batch-1',
      eventLogId: `event-${index}`,
      eventHash,
      leafIndex: index,
      createdAt: new Date(),
    })),
  };
}

describe('AnchorConfirmationProcessor', () => {
  function setup() {
    const repository = {
      findBatchWithLeaves: jest.fn(),
      confirmBatch: jest.fn().mockResolvedValue(undefined),
      markDisputed: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
      listSubmittedBatchIds: jest.fn().mockResolvedValue([]),
    };
    const logging = { log: jest.fn().mockResolvedValue(undefined) };
    const gateway = new FakeAnchorGateway();
    const processor = new AnchorConfirmationProcessor(
      repository as unknown as AnchorBatchRepository,
      gateway,
      logging as unknown as LoggingService,
    );

    return { repository, logging, gateway, processor };
  }

  it('confirms a batch and stamps all included events with txHash and blockHeight', async () => {
    const { repository, gateway, processor } = setup();
    const submission = await gateway.submitRoot(tree.root);
    repository.findBatchWithLeaves.mockResolvedValue(
      batchWith(submission.txHash),
    );

    const result = await processor.process('batch-1');

    expect(result.status).toBe('CONFIRMED');
    expect(result.blockHeight).toEqual(expect.any(Number));
    expect(repository.confirmBatch).toHaveBeenCalledWith({
      batchId: 'batch-1',
      txHash: submission.txHash,
      blockHeight: result.blockHeight,
      confirmedAt: expect.any(Date) as Date,
      eventLogIds: ['event-0', 'event-1'],
      merkleRoot: tree.root,
    });
  });

  it('marks the batch DISPUTED and raises a critical alert on root mismatch', async () => {
    const { repository, logging, gateway, processor } = setup();
    const submission = await gateway.submitRoot(tree.root);
    gateway.tamperRoot(submission.txHash, sha256Hex('different-root'));
    repository.findBatchWithLeaves.mockResolvedValue(
      batchWith(submission.txHash),
    );

    const result = await processor.process('batch-1');

    expect(result.status).toBe('DISPUTED');
    expect(repository.confirmBatch).not.toHaveBeenCalled();
    expect(repository.markDisputed).toHaveBeenCalledWith(
      'batch-1',
      expect.stringContaining('does not match'),
    );
    expect(logging.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ANCHOR_ROOT_MISMATCH',
        level: 'ERROR',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest matcher returns any
        metadata: expect.objectContaining({ severity: 'CRITICAL' }),
      }),
    );
  });

  it('leaves a batch pending when the chain lookup fails', async () => {
    const { repository, processor } = setup();
    repository.findBatchWithLeaves.mockResolvedValue(
      batchWith('unknown-transaction'),
    );

    const result = await processor.process('batch-1');

    expect(result.status).toBe('PENDING');
    expect(repository.confirmBatch).not.toHaveBeenCalled();
  });
});
