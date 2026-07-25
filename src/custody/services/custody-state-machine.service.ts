import { Injectable } from '@nestjs/common';
import { CustodyStatus } from '@prisma/client';
import { DomainException } from '../../common/exceptions/domain.exception';

/**
 * Explicit transition map defining valid CustodyStatus transitions.
 * Each key maps to an array of statuses it can transition to.
 */
const VALID_TRANSITIONS: Record<CustodyStatus, CustodyStatus[]> = {
  [CustodyStatus.ACTIVE]: [
    CustodyStatus.RETURNED,
    CustodyStatus.CANCELLED,
    CustodyStatus.VIOLATION,
  ],
  [CustodyStatus.RETURNED]: [],
  [CustodyStatus.CANCELLED]: [],
  [CustodyStatus.VIOLATION]: [],
  [CustodyStatus.PENDING]: [CustodyStatus.ACTIVE, CustodyStatus.CANCELLED],
};

@Injectable()
export class CustodyStateMachine {
  /**
   * Returns true if transitioning from `fromStatus` to `toStatus` is valid.
   */
  canTransition(fromStatus: CustodyStatus, toStatus: CustodyStatus): boolean {
    const allowed = VALID_TRANSITIONS[fromStatus];
    if (!allowed) {
      return false;
    }
    return allowed.includes(toStatus);
  }

  /**
   * Returns the list of valid transitions from a given status.
   */
  getValidTransitions(fromStatus: CustodyStatus): CustodyStatus[] {
    return VALID_TRANSITIONS[fromStatus] ?? [];
  }

  /**
   * Checks if the transition is valid. Throws DomainException if invalid.
   */
  assertCanTransition(fromStatus: CustodyStatus, toStatus: CustodyStatus): void {
    if (!this.canTransition(fromStatus, toStatus)) {
      throw new DomainException(
        `Invalid custody status transition: ${fromStatus} → ${toStatus}. ` +
        `Allowed transitions from ${fromStatus}: [${(VALID_TRANSITIONS[fromStatus] ?? []).join(', ')}]`,
      );
    }
  }

  /**
   * Returns a frozen copy of the valid transitions map (useful for introspection / tests).
   */
  getTransitionsMap(): Readonly<Record<CustodyStatus, readonly CustodyStatus[]>> {
    return VALID_TRANSITIONS;
  }
}
