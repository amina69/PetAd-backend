import { Test, TestingModule } from '@nestjs/testing';
import { OutboxService } from './outbox.service';

describe('OutboxService', () => {
  let service: OutboxService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OutboxService],
    }).compile();

    service = module.get<OutboxService>(OutboxService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('writes an outbox record via the transaction client', async () => {
    const mockTx = {
      outboxMessage: {
        create: jest.fn().mockResolvedValue({ id: 'msg-1' }),
      },
    } as any;

    await service.write(mockTx, 'ESCROW_RELEASE', { escrowId: 'e1' });

    expect(mockTx.outboxMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'ESCROW_RELEASE',
        payload: { escrowId: 'e1' },
        status: 'PENDING',
      }),
    });
  });
});
