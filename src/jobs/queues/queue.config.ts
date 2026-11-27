import type { ConfigService } from '@nestjs/config';
import type { Job, JobsOptions } from 'bullmq';
import type { SendTransactionalEmailDto } from '../../email/dto/send-transactional-email.dto';

export enum QueueName {
  BLOCKCHAIN_CONFIRMATION = 'blockchain-confirmation',
  ANCHORING = 'anchoring',
  NOTIFICATIONS = 'notifications',
  EMAIL = 'email',
  DOCUMENT_SCAN = 'document-scan',
  DATA_EXPORT = 'data-export',
  CLEANUP = 'cleanup',
  OUTBOX = 'outbox',
}

export enum JobName {
  CONFIRM_BLOCKCHAIN_TRANSACTION = 'confirm_blockchain_transaction',
  ANCHOR_EVENT = 'anchor_event',
  SEND_TRANSACTIONAL_EMAIL = 'send_transactional_email',
  SEND_EMAIL = 'send_email',
  SCAN_DOCUMENT = 'scan_document',
  PROCESS_DATA_EXPORT = 'process_data_export',
  CLEANUP_DATA_EXPORT = 'cleanup_data_export',
  RUN_CLEANUP = 'run_cleanup',
  PROCESS_OUTBOX = 'process_outbox',
}

export interface SendTransactionalEmailJobPayload {
  dto: SendTransactionalEmailDto;
  metadata?: Record<string, unknown>;
}

export interface DataExportJobPayload {
  exportId: string;
  userId: string;
}

export interface BlockchainConfirmationJobPayload {
  anchorId: string;
  transactionHash: string;
  attempts?: number;
}

export interface AnchoringJobPayload {
  aggregateType: string;
  aggregateId: string;
  eventIds: string[];
}

export interface EmailJobPayload {
  to: string;
  subject: string;
  template: string;
  variables?: Record<string, unknown>;
}

export interface DocumentScanJobPayload {
  documentId: string;
  fileUrl: string;
}

export interface CleanupJobPayload {
  resource: 'data_exports' | 'sessions' | 'event_logs';
  olderThanDays: number;
}

export interface OutboxJobPayload {
  outboxId: string;
}

export interface QueueJobPayloadMap {
  [QueueName.BLOCKCHAIN_CONFIRMATION]: {
    [JobName.CONFIRM_BLOCKCHAIN_TRANSACTION]: BlockchainConfirmationJobPayload;
  };
  [QueueName.ANCHORING]: {
    [JobName.ANCHOR_EVENT]: AnchoringJobPayload;
  };
  [QueueName.NOTIFICATIONS]: {
    [JobName.SEND_TRANSACTIONAL_EMAIL]: SendTransactionalEmailJobPayload;
  };
  [QueueName.EMAIL]: {
    [JobName.SEND_EMAIL]: EmailJobPayload;
  };
  [QueueName.DOCUMENT_SCAN]: {
    [JobName.SCAN_DOCUMENT]: DocumentScanJobPayload;
  };
  [QueueName.DATA_EXPORT]: {
    [JobName.PROCESS_DATA_EXPORT]: DataExportJobPayload;
    [JobName.CLEANUP_DATA_EXPORT]: DataExportJobPayload;
  };
  [QueueName.CLEANUP]: {
    [JobName.RUN_CLEANUP]: CleanupJobPayload;
  };
  [QueueName.OUTBOX]: {
    [JobName.PROCESS_OUTBOX]: OutboxJobPayload;
  };
}

export type JobNameFor<Q extends QueueName> = keyof QueueJobPayloadMap[Q] &
  JobName;

export type JobPayload<
  Q extends QueueName,
  J extends JobNameFor<Q>,
> = QueueJobPayloadMap[Q][J];

export type QueuePayload<Q extends QueueName> =
  QueueJobPayloadMap[Q][JobNameFor<Q>];

export type TypedJob<Q extends QueueName, J extends JobNameFor<Q>> = Job<
  JobPayload<Q, J>,
  void,
  J & string
>;

export type NotificationEmailJob = TypedJob<
  QueueName.NOTIFICATIONS,
  JobName.SEND_TRANSACTIONAL_EMAIL
>;

export type ProcessDataExportJob = TypedJob<
  QueueName.DATA_EXPORT,
  JobName.PROCESS_DATA_EXPORT
>;

export const NOTIFICATION_QUEUE_NAME = QueueName.NOTIFICATIONS;
export const DATA_EXPORT_QUEUE_NAME = QueueName.DATA_EXPORT;
export const SEND_TRANSACTIONAL_EMAIL_JOB_NAME =
  JobName.SEND_TRANSACTIONAL_EMAIL;
export const PROCESS_DATA_EXPORT_JOB_NAME = JobName.PROCESS_DATA_EXPORT;
export const CLEANUP_DATA_EXPORT_JOB_NAME = JobName.CLEANUP_DATA_EXPORT;

export const ANCHORING_QUEUE_NAME = 'anchoring';
export const ANCHOR_EVENTS_JOB_NAME = 'anchor_events';

export function getRedisConnection(configService: ConfigService) {
  const redisUrl = configService.get<string>('REDIS_URL');
  if (!redisUrl) {
    throw new Error('Missing required env var `REDIS_URL` for BullMQ queues.');
  }

  return { url: redisUrl };
}

export function getQueuePrefix(configService: ConfigService): string {
  const environment =
    configService.get<string>('nodeEnv') ??
    configService.get<string>('NODE_ENV') ??
    'development';

  return `petad:${environment}`;
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

export function getDefaultJobOptions(
  configService: ConfigService,
): JobsOptions {
  return {
    attempts: getJobAttempts(configService),
    backoff: { type: 'fixed', delay: getJobBackoffDelay(configService) },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  };
}
