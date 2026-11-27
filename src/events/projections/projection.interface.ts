import { EventType } from '@prisma/client';

export interface Projection {
  readonly name: string;
  readonly handles: EventType[];
  apply(event: { id: string; eventType: EventType; payload: any; entityType: string; entityId: string; createdAt: Date }): Promise<void>;
  reset(): Promise<void>;
}
