import { Injectable } from '@nestjs/common';
import { AdoptionStatus } from '@prisma/client';
import { DomainException } from '../../common/exceptions/domain.exception';

/**
 * Explicit transition map defining valid AdoptionStatus transitions.
 * Each key maps to an array of statuses it can transition to.
 */
const VALID_TRANSITIONS: Record<AdoptionStatus, AdoptionStatus[]> = {
  [AdoptionStatus.REQUESTED]: [AdoptionStatus.PENDING, AdoptionStatus.REJECTED],
  [AdoptionStatus.PENDING]: [AdoptionStatus.APPROVED, AdoptionStatus.REJECTED],
  [AdoptionStatus.APPROVED]: [AdoptionStatus.ESCROW_FUNDED, AdoptionStatus.CANCELLED],
  [AdoptionStatus.ESCROW_FUNDED]: [AdoptionStatus.COMPLETED, AdoptionStatus.CANCELLED],
  [AdoptionStatus.COMPLETED]: [],
  [AdoptionStatus.REJECTED]: [],
  [AdoptionStatus.CANCELLED]: [],
};

@Injectable()
export class AdoptionStateMachine {
  /**
   * Returns true if transitioning from `fromStatus` to `toStatus` is valid.
   */
  canTransition(fromStatus: AdoptionStatus, toStatus: AdoptionStatus): boolean {
    const allowed = VALID_TRANSITIONS[fromStatus];
    if (!allowed) {
      return false;
    }
    return allowed.includes(toStatus);
  }

  /**
   * Checks if the transition is valid. Throws DomainException if invalid.
   */
  assertValidTransition(fromStatus: AdoptionStatus, toStatus: AdoptionStatus): void {
    if (!this.canTransition(fromStatus, toStatus)) {
      throw new DomainException(
        `Invalid adoption status transition: ${fromStatus} → ${toStatus}. ` +
        `Allowed transitions from ${fromStatus}: [${(VALID_TRANSITIONS[fromStatus] ?? []).join(', ')}]`,
      );
    }
  }

  /**
   * Returns a frozen copy of the valid transitions map (useful for introspection / tests).
   */
  getValidTransitions(): Readonly<Record<AdoptionStatus, readonly AdoptionStatus[]>> {
    return VALID_TRANSITIONS;
  }
}
