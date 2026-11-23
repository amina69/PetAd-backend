/** Stable scheduler IDs. JobSchedulers are shared by all application instances. */
export const SCHEDULES = [
  { name: 'custody-activation', pattern: '*/5 * * * *' },
  { name: 'custody-reminders', pattern: '0 * * * *' },
  { name: 'custody-overdue', pattern: '*/15 * * * *' },
  { name: 'approval-expiry', pattern: '*/5 * * * *' },
  { name: 'escrow-timeout', pattern: '*/5 * * * *' },
  { name: 'reconciliation', pattern: '*/15 * * * *' },
  { name: 'session-token-cleanup', pattern: '0 * * * *' },
  { name: 'notification-retention', pattern: '0 2 * * *' },
  { name: 'export-retention', pattern: '0 3 * * *' },
  { name: 'document-retention', pattern: '0 4 * * *' },
  { name: 'snapshot-verification', pattern: '0 */6 * * *' },
] as const;

export type ScheduleName = (typeof SCHEDULES)[number]['name'];
export const SCHEDULER_QUEUE = 'petad-scheduler';
