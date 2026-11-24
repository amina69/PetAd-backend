import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { NotificationDeadLetterService } from './notification-dead-letter.service';
import { NotificationMetricsService } from './notification-metrics.service';

jest.mock('bullmq', () => ({
  Queue: jest.fn(),
}));

describe('NotificationDeadLetterService', () => {
  const addMock = jest.fn().mockResolvedValue({ id: 'dlq-job' });
  const metrics = new NotificationMetricsService();

  beforeEach(() => {
    jest.clearAllMocks();
    (Queue as unknown as jest.Mock).mockImplementation(() => ({
      add: addMock,
      close: jest.fn(),
    }));
  });

  it('stores a poison message with its failure reason', async () => {
    const service = new NotificationDeadLetterService(
      {
        get: jest.fn((key: string) =>
          key === 'REDIS_URL' ? 'redis://localhost:6379' : undefined,
        ),
      } as unknown as ConfigService,
      metrics,
    );

    await service.moveToDeadLetter(
      {
        id: 'job-poison',
        name: 'send_transactional_email',
        queueName: 'notifications',
        attemptsMade: 3,
        data: { dto: { to: 'x@example.com' } },
      } as any,
      'Invalid recipient address',
    );

    expect(addMock).toHaveBeenCalledWith(
      'dead_letter',
      expect.objectContaining({
        originalJobId: 'job-poison',
        attemptsMade: 3,
        failedReason: 'Invalid recipient address',
      }),
      expect.objectContaining({ jobId: 'dlq:job-poison' }),
    );
    expect(metrics.snapshot().deadLettered).toBe(1);
  });
});
