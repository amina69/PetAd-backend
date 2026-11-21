import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { WebhookService } from './webhook.service';
import { PrismaService } from '../prisma/prisma.service';
import { LoggingService } from '../logging/logging.service';
import { WebhookSignatureService } from './webhook-signature.service';
import { WebhookQueueService } from './webhook.queue.service';

describe('WebhookService', () => {
  let service: WebhookService;

  const rawBody = Buffer.from('{"id":"evt_1"}');
  const verified = {
    eventId: 'evt_1',
    eventType: 'payment.succeeded',
    timestamp: Math.floor(Date.now() / 1000),
  };
  const mockPrisma = {
    webhookEvent: {
      create: jest.fn(),
      delete: jest.fn(),
    },
  };
  const mockSignatures = {
    verify: jest.fn().mockReturnValue(verified),
  };
  const mockQueue = { enqueueWebhook: jest.fn() };
  const mockLogging = { log: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    mockSignatures.verify.mockReturnValue(verified);
    mockPrisma.webhookEvent.create.mockResolvedValue({ id: 'delivery-1' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: WebhookSignatureService, useValue: mockSignatures },
        { provide: WebhookQueueService, useValue: mockQueue },
        { provide: LoggingService, useValue: mockLogging },
      ],
    }).compile();
    service = module.get(WebhookService);
  });

  it('acknowledges quickly and queues a new event once', async () => {
    const result = await service.receive('stripe', rawBody, {});

    expect(result).toEqual({
      received: true,
      duplicate: false,
      deliveryId: 'delivery-1',
    });
    expect(mockQueue.enqueueWebhook).toHaveBeenCalledTimes(1);
    expect(mockLogging.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'WEBHOOK_RECEIVED' }),
    );
  });

  it('processes the same provider event only once', async () => {
    let attempts = 0;
    mockPrisma.webhookEvent.create.mockReset().mockImplementation(async () => {
      attempts += 1;
      if (attempts === 2) {
        throw new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: '7.6.0',
        });
      }
      return { id: 'delivery-2' };
    });

    const first = await service.receive('stripe', rawBody, {});
    const second = await service.receive('stripe', rawBody, {});

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(mockQueue.enqueueWebhook).toHaveBeenCalledTimes(1);
    expect(mockLogging.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'WEBHOOK_DUPLICATE' }),
    );
  });

  it('rolls back the idempotency marker when enqueueing fails', async () => {
    mockQueue.enqueueWebhook.mockRejectedValueOnce(new Error('redis down'));

    await expect(service.receive('stripe', rawBody, {})).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(mockPrisma.webhookEvent.delete).toHaveBeenCalledWith({
      where: { id: 'delivery-1' },
    });
  });
});
