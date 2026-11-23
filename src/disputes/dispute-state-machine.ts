import { Injectable, ConflictException } from '@nestjs/common';
import { DisputeStatus } from '@prisma/client';

export const DISPUTE_TRANSITIONS: Record<DisputeStatus, DisputeStatus[]> = {
  [DisputeStatus.OPEN]: [DisputeStatus.UNDER_REVIEW, DisputeStatus.WITHDRAWN],
  [DisputeStatus.UNDER_REVIEW]: [
    DisputeStatus.RESOLVED,
    DisputeStatus.RESOLUTION_PENDING,
    DisputeStatus.WITHDRAWN,
  ],
  [DisputeStatus.RESOLUTION_PENDING]: [
    DisputeStatus.RESOLVED,
    DisputeStatus.UNDER_REVIEW,
  ],
  [DisputeStatus.RESOLVED]: [],
  [DisputeStatus.WITHDRAWN]: [],
};

export const ADMIN_REQUIRED_TRANSITIONS: DisputeStatus[] = [
  DisputeStatus.UNDER_REVIEW,
  DisputeStatus.RESOLVED,
  DisputeStatus.RESOLUTION_PENDING,
];

@Injectable()
export class DisputeStateMachine {
  isValidTransition(from: DisputeStatus, to: DisputeStatus): boolean {
    return DISPUTE_TRANSITIONS[from]?.includes(to) ?? false;
  }

  assertValidTransition(from: DisputeStatus, to: DisputeStatus): void {
    if (!this.isValidTransition(from, to)) {
      throw new ConflictException({
        message: `Cannot transition dispute from ${from} to ${to}`,
        code: 'DISPUTE_INVALID_TRANSITION',
        from,
        to,
      });
    }
  }

  requiresAdmin(to: DisputeStatus): boolean {
    return ADMIN_REQUIRED_TRANSITIONS.includes(to);
  }
}
