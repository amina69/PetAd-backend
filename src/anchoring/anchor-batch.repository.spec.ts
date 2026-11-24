import { AnchorBatchRepository } from './anchor-batch.repository';

describe('AnchorBatchRepository.confirmBatch', () => {
  it('stamps every included event in a single UPDATE statement', async () => {
    const transaction = {
      anchorBatch: { update: jest.fn().mockResolvedValue({}) },
      eventLog: {
        updateMany: jest.fn().mockResolvedValue({ count: 3 }),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (client: typeof transaction) => unknown) =>
          callback(transaction),
      ),
    };

    const repository = new AnchorBatchRepository(prisma as never);

    await repository.confirmBatch({
      batchId: 'batch-1',
      txHash: 'a'.repeat(64),
      blockHeight: 42,
      confirmedAt: new Date('2026-11-24T10:00:00.000Z'),
      eventLogIds: ['event-1', 'event-2', 'event-3'],
      merkleRoot: 'b'.repeat(64),
    });

    expect(transaction.eventLog.updateMany).toHaveBeenCalledTimes(1);
    expect(transaction.eventLog.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['event-1', 'event-2', 'event-3'] } },
      data: {
        txHash: 'a'.repeat(64),
        blockHeight: 42,
        anchorBatchId: 'batch-1',
      },
    });

    expect(transaction.eventLog.create).toHaveBeenCalledWith({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest matcher returns any
      data: expect.objectContaining({
        entityType: 'ANCHOR',
        entityId: 'batch-1',
        eventType: 'EVENTS_ANCHORED',
        txHash: 'a'.repeat(64),
        blockHeight: 42,
      }),
    });
  });
});
