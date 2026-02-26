import { Injectable } from '@nestjs/common';

// Define AdoptionStatus enum locally until Prisma client is properly regenerated
export enum AdoptionStatus {
  REQUESTED = 'REQUESTED',
  PENDING_REVIEW = 'PENDING_REVIEW',
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  ESCROW_FUNDED = 'ESCROW_FUNDED',
  COMPLETED = 'COMPLETED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
}

@Injectable()
export class AdoptionStateMachine {
  private readonly validTransitions: Record<AdoptionStatus, AdoptionStatus[]> = {
    [AdoptionStatus.REQUESTED]: [AdoptionStatus.PENDING_REVIEW, AdoptionStatus.REJECTED],
    [AdoptionStatus.PENDING_REVIEW]: [AdoptionStatus.APPROVED, AdoptionStatus.REJECTED],
    [AdoptionStatus.PENDING]: [AdoptionStatus.APPROVED, AdoptionStatus.REJECTED],
    [AdoptionStatus.APPROVED]: [AdoptionStatus.ESCROW_FUNDED, AdoptionStatus.CANCELLED],
    [AdoptionStatus.ESCROW_FUNDED]: [AdoptionStatus.COMPLETED, AdoptionStatus.REFUNDED],
    [AdoptionStatus.COMPLETED]: [], // Terminal state
    [AdoptionStatus.REJECTED]: [], // Terminal state
    [AdoptionStatus.CANCELLED]: [], // Terminal state
    [AdoptionStatus.REFUNDED]: [], // Terminal state
  };

  /**
   * Check if a transition from one status to another is valid
   * @param from Current adoption status
   * @param to Target adoption status
   * @returns true if transition is valid, false otherwise
   */
  canTransition(from: AdoptionStatus, to: AdoptionStatus): boolean {
    const allowedTransitions = this.validTransitions[from];
    return allowedTransitions.includes(to);
  }

  /**
   * Validate a transition and throw an exception if invalid
   * @param from Current adoption status
   * @param to Target adoption status
   * @throws DomainException if transition is invalid
   */
  validateTransition(from: AdoptionStatus, to: AdoptionStatus): void {
    if (!this.canTransition(from, to)) {
      throw new DomainException(
        `Invalid adoption status transition: ${from} → ${to}. ` +
        `Valid transitions from ${from}: ${this.validTransitions[from].join(', ')}`
      );
    }
  }

  /**
   * Get all valid transitions from a given status
   * @param from Current adoption status
   * @returns Array of valid target statuses
   */
  getValidTransitions(from: AdoptionStatus): AdoptionStatus[] {
    return [...this.validTransitions[from]];
  }

  /**
   * Check if a status is a terminal state (no further transitions allowed)
   * @param status Adoption status to check
   * @returns true if status is terminal
   */
  isTerminalStatus(status: AdoptionStatus): boolean {
    return this.validTransitions[status].length === 0;
  }

  /**
   * Check if a transition can be overridden by admin
   * Admins can override certain restrictions for operational reasons
   * @param from Current adoption status
   * @param to Target adoption status
   * @param isAdmin Whether the user is an admin
   * @returns true if transition is allowed
   */
  canAdminOverride(from: AdoptionStatus, to: AdoptionStatus, isAdmin: boolean): boolean {
    if (!isAdmin) {
      return this.canTransition(from, to);
    }

    // Admins can override some restrictions but still maintain basic integrity
    // Cannot reactivate completed adoptions
    if (from === AdoptionStatus.COMPLETED && to !== AdoptionStatus.COMPLETED) {
      return false;
    }

    // Cannot change rejected to approved (would bypass review)
    if (from === AdoptionStatus.REJECTED && to === AdoptionStatus.APPROVED) {
      return false;
    }

    return true;
  }

  /**
   * Check if escrow release is allowed for this status
   * Escrow release should only be allowed when status is ESCROW_FUNDED
   * @param status Current adoption status
   * @returns true if escrow release is allowed
   */
  canReleaseEscrow(status: AdoptionStatus): boolean {
    return status === AdoptionStatus.ESCROW_FUNDED;
  }

  /**
   * Check if adoption can be marked as completed
   * @param status Current adoption status
   * @returns true if adoption can be completed
   */
  canComplete(status: AdoptionStatus): boolean {
    return status === AdoptionStatus.ESCROW_FUNDED;
  }
}

/**
 * Custom exception for domain rule violations
 */
export class DomainException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainException';
  }
}
