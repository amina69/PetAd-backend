export type NotificationAudience =
  | 'ADOPTER'
  | 'OWNER'
  | 'HOLDER'
  | 'ACTOR'
  | 'ADMINS'
  | 'COUNTERPARTY';

export type NotificationChannel = 'EMAIL' | 'PUSH' | 'IN_APP';
export type NotificationPriority = 'HIGH' | 'NORMAL';

export interface NotificationRule {
  audience: NotificationAudience;
  template: string;
  channels: NotificationChannel[];
  /** HIGH notifications also drive the frontend toast. */
  priority: NotificationPriority;
}

/**
 * Declarative event → notification map.
 *
 * Keys are event type strings (not the Prisma enum) so emitting a new event
 * type requires no changes here or in the mapper. Adding a notification is
 * purely data: add a rule (and a template in templates/catalog.ts).
 */
export const NOTIFICATION_RULES: Record<string, NotificationRule[]> = {
  ADOPTION_REQUESTED: [
    {
      audience: 'OWNER',
      template: 'adoption-requested-owner',
      channels: ['EMAIL', 'IN_APP'],
      priority: 'HIGH',
    },
    {
      audience: 'ADOPTER',
      template: 'adoption-requested-adopter',
      channels: ['IN_APP'],
      priority: 'NORMAL',
    },
  ],
  ADOPTION_APPROVED: [
    {
      audience: 'ADOPTER',
      template: 'adoption-approved-adopter',
      channels: ['EMAIL', 'PUSH', 'IN_APP'],
      priority: 'HIGH',
    },
    {
      audience: 'OWNER',
      template: 'adoption-approved-owner',
      channels: ['IN_APP'],
      priority: 'NORMAL',
    },
  ],
  ADOPTION_REJECTED: [
    {
      audience: 'ADOPTER',
      template: 'adoption-rejected-adopter',
      channels: ['EMAIL', 'PUSH', 'IN_APP'],
      priority: 'HIGH',
    },
  ],
  ADOPTION_CANCELLED: [
    {
      audience: 'ADOPTER',
      template: 'adoption-cancelled',
      channels: ['IN_APP'],
      priority: 'NORMAL',
    },
    {
      audience: 'OWNER',
      template: 'adoption-cancelled',
      channels: ['IN_APP'],
      priority: 'NORMAL',
    },
  ],
  ADOPTION_COMPLETED: [
    {
      audience: 'ADOPTER',
      template: 'adoption-completed',
      channels: ['EMAIL', 'IN_APP'],
      priority: 'HIGH',
    },
    {
      audience: 'OWNER',
      template: 'adoption-completed',
      channels: ['EMAIL', 'IN_APP'],
      priority: 'NORMAL',
    },
  ],
  CUSTODY_CREATED: [
    {
      audience: 'HOLDER',
      template: 'custody-created-holder',
      channels: ['EMAIL', 'IN_APP'],
      priority: 'HIGH',
    },
    {
      audience: 'OWNER',
      template: 'custody-created-owner',
      channels: ['IN_APP'],
      priority: 'NORMAL',
    },
  ],
  CUSTODY_STARTED: [
    {
      audience: 'HOLDER',
      template: 'custody-started',
      channels: ['EMAIL', 'IN_APP'],
      priority: 'NORMAL',
    },
  ],
  CUSTODY_COMPLETED: [
    {
      audience: 'HOLDER',
      template: 'custody-completed',
      channels: ['IN_APP'],
      priority: 'NORMAL',
    },
    {
      audience: 'OWNER',
      template: 'custody-completed',
      channels: ['IN_APP'],
      priority: 'NORMAL',
    },
  ],
  CUSTODY_RETURNED: [
    {
      audience: 'OWNER',
      template: 'custody-completed',
      channels: ['IN_APP'],
      priority: 'NORMAL',
    },
  ],
  CUSTODY_VIOLATION: [
    {
      audience: 'HOLDER',
      template: 'custody-violation',
      channels: ['EMAIL', 'PUSH', 'IN_APP'],
      priority: 'HIGH',
    },
    {
      audience: 'OWNER',
      template: 'custody-violation',
      channels: ['EMAIL', 'IN_APP'],
      priority: 'HIGH',
    },
    {
      audience: 'ADMINS',
      template: 'custody-violation',
      channels: ['IN_APP'],
      priority: 'HIGH',
    },
  ],
  ESCROW_CREATED: [
    {
      audience: 'ADOPTER',
      template: 'escrow-update',
      channels: ['IN_APP'],
      priority: 'NORMAL',
    },
  ],
  ESCROW_FUNDED: [
    {
      audience: 'ADOPTER',
      template: 'escrow-update',
      channels: ['IN_APP'],
      priority: 'HIGH',
    },
    {
      audience: 'OWNER',
      template: 'escrow-update',
      channels: ['IN_APP'],
      priority: 'HIGH',
    },
  ],
  ESCROW_RELEASED: [
    {
      audience: 'ADOPTER',
      template: 'escrow-update',
      channels: ['EMAIL', 'IN_APP'],
      priority: 'HIGH',
    },
    {
      audience: 'OWNER',
      template: 'escrow-update',
      channels: ['EMAIL', 'IN_APP'],
      priority: 'HIGH',
    },
  ],
  ESCROW_REFUNDED: [
    {
      audience: 'ADOPTER',
      template: 'escrow-update',
      channels: ['IN_APP'],
      priority: 'NORMAL',
    },
  ],
  USER_REGISTERED: [
    {
      audience: 'ACTOR',
      template: 'user-registered',
      channels: ['EMAIL', 'IN_APP'],
      priority: 'NORMAL',
    },
  ],
  USER_SUSPENDED: [
    {
      audience: 'ACTOR',
      template: 'account-suspended',
      channels: ['EMAIL', 'IN_APP'],
      priority: 'HIGH',
    },
  ],
  USER_REINSTATED: [
    {
      audience: 'ACTOR',
      template: 'account-reinstated',
      channels: ['EMAIL', 'IN_APP'],
      priority: 'NORMAL',
    },
  ],
  PET_ADOPTED: [
    {
      audience: 'OWNER',
      template: 'pet-adopted',
      channels: ['IN_APP'],
      priority: 'NORMAL',
    },
  ],
  PET_RETURNED: [
    {
      audience: 'OWNER',
      template: 'pet-returned',
      channels: ['IN_APP'],
      priority: 'NORMAL',
    },
  ],
};
