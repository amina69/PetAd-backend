export const OUTBOX_QUEUE_NAME = 'outbox';
export const OUTBOX_RELAY_JOB_NAME = 'relay';

/** Maximum number of delivery attempts before the message is marked FAILED. */
export const OUTBOX_MAX_ATTEMPTS = 5;

/** How many messages to lock and relay per poll cycle. */
export const OUTBOX_BATCH_SIZE = 50;

export interface OutboxMessagePayload {
  type: string;
  payload: Record<string, unknown>;
}
