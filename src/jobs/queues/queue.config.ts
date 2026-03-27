import type { ConfigService } from '@nestjs/config';

export const NOTIFICATION_QUEUE_NAME = 'notifications';
export const SEND_TRANSACTIONAL_EMAIL_JOB_NAME = 'send_transactional_email';

export function getRedisConnection(configService: ConfigService) {
  const redisUrl = configService.get<string>('REDIS_URL');
  if (!redisUrl) {
    throw new Error(
      'Missing required env var `REDIS_URL` for BullMQ queues.',
    );
  }

  return { url: redisUrl };
}

export function getQueueConcurrency(configService: ConfigService): number {
  const raw = configService.get<string>('QUEUE_CONCURRENCY');
  const parsed = raw ? Number.parseInt(raw, 10) : 5;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

export function getJobAttempts(configService: ConfigService): number {
  const raw = configService.get<string>('JOB_ATTEMPTS');
  const parsed = raw ? Number.parseInt(raw, 10) : 3;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

export function getJobBackoffDelay(configService: ConfigService): number {
  const raw = configService.get<string>('JOB_BACKOFF_DELAY');
  const parsed = raw ? Number.parseInt(raw, 10) : 5000;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 5000;
}

