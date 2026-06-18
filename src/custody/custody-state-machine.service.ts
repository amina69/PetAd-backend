import { BadRequestException, Injectable } from '@nestjs/common';
import { CustodyStatus } from '@prisma/client';

/**
 * Valid transitions for the Custody lifecycle.
 *
 *   PENDING  → ACTIVE | CANCELLED
 *   ACTIVE   → RETURNED | CANCELLED | VIOLATION
 *   RETURNED → (terminal)
 *   CANCELLED→ (terminal)
 *   VIOLATION→ (terminal)
 */
const TRANSITIONS: Record<CustodyStatus, CustodyStatus[]> = {
  [CustodyStatus.PENDING]: [CustodyStatus.ACTIVE, CustodyStatus.CANCELLED],
  [CustodyStatus.ACTIVE]: [
    CustodyStatus.RETURNED,
    CustodyStatus.CANCELLED,
    CustodyStatus.VIOLATION,
  ],
  [CustodyStatus.RETURNED]: [],
  [CustodyStatus.CANCELLED]: [],
  [CustodyStatus.VIOLATION]: [],
};

@Injectable()
export class CustodyStateMachine {
  /**
   * Returns true if transitioning from `from` → `to` is valid.
   */
  canTransition(from: CustodyStatus, to: CustodyStatus): boolean {
    return TRANSITIONS[from]?.includes(to) ?? false;
  }

  /**
   * Asserts the transition is valid; throws BadRequestException otherwise.
   * Use this in service methods to guard every status update.
   */
  assertTransition(from: CustodyStatus, to: CustodyStatus): void {
    if (!this.canTransition(from, to)) {
      const isTerminal = TRANSITIONS[from]?.length === 0;
      const message = isTerminal
        ? `Custody is in a terminal state (${from}) and cannot be transitioned`
        : `Invalid custody transition: ${from} → ${to}. Allowed: ${TRANSITIONS[from].join(', ')}`;
      throw new BadRequestException(message);
    }
  }

  /**
   * Returns the allowed next states for a given status.
   * Useful for introspection / API documentation.
   */
  getAllowedTransitions(from: CustodyStatus): CustodyStatus[] {
    return [...(TRANSITIONS[from] ?? [])];
  }

  /**
   * Returns true if the status has no valid outgoing transitions.
   */
  isTerminal(status: CustodyStatus): boolean {
    return TRANSITIONS[status]?.length === 0;
  }
}
