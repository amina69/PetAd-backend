import {
  getDefaultJobOptions,
  getQueuePrefix,
  JobName,
  QueueName,
} from './queue.config';
import type { ConfigService } from '@nestjs/config';
import type { TypedQueueService } from './typed-queue.service';

function config(values: Record<string, string>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

function compileTimePayloadChecks(queues: TypedQueueService): void {
  void queues.add(QueueName.NOTIFICATIONS, JobName.SEND_TRANSACTIONAL_EMAIL, {
    dto: { to: 'user@example.com', subject: 'Subject', text: 'Body' },
  });

  // @ts-expect-error a data-export payload cannot be sent to the notifications queue
  void queues.add(QueueName.NOTIFICATIONS, JobName.SEND_TRANSACTIONAL_EMAIL, {
    exportId: 'export-1',
    userId: 'user-1',
  });

  // @ts-expect-error unknown queue names are rejected by the registry
  void queues.add('unknown-queue', JobName.SEND_EMAIL, { to: 'x' });
}

void compileTimePayloadChecks;

describe('queue registry', () => {
  it('defines the planned queues in one enum', () => {
    expect(Object.values(QueueName)).toEqual([
      'blockchain-confirmation',
      'anchoring',
      'notifications',
      'email',
      'document-scan',
      'data-export',
      'cleanup',
      'outbox',
    ]);
  });

  it('prefixes Redis keys with the environment', () => {
    expect(getQueuePrefix(config({ nodeEnv: 'test' }))).toBe('petad:test');
    expect(getQueuePrefix(config({ NODE_ENV: 'production' }))).toBe(
      'petad:production',
    );
    expect(getQueuePrefix(config({}))).toBe('petad:development');
  });

  it('shares default retry and retention options', () => {
    const options = getDefaultJobOptions(
      config({
        JOB_ATTEMPTS: '4',
        JOB_BACKOFF_DELAY: '1234',
      }),
    );

    expect(options).toMatchObject({
      attempts: 4,
      backoff: { type: 'fixed', delay: 1234 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  });
});
