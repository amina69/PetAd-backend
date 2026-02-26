import { BadRequestException } from '@nestjs/common';
import { CustodyStatus } from '@prisma/client';

/**
 * Custody Status Transition Validator
 * Implements state machine for custody status lifecycle
 *
 * Valid Transitions:
 * ACTIVE → RETURNED (custody completed normally)
 * ACTIVE → CANCELLED (custody cancelled before completion)
 * ACTIVE → VIOLATION (trust violation occurred)
 *
 * Terminal States (immutable):
 * - RETURNED
 * - CANCELLED
 * - VIOLATION
 */
export class CustodyStatusTransitionValidator {
  /**
   * Defines allowed status transitions
   * Maps from current status to array of allowed target statuses
   */
  private static readonly ALLOWED_TRANSITIONS: Record<
    CustodyStatus,
    CustodyStatus[]
  > = {
    [CustodyStatus.ACTIVE]: [
      CustodyStatus.RETURNED,
      CustodyStatus.CANCELLED,
      CustodyStatus.VIOLATION,
    ],
    [CustodyStatus.RETURNED]: [], // Terminal state
    [CustodyStatus.CANCELLED]: [], // Terminal state
    [CustodyStatus.VIOLATION]: [], // Terminal state
  };

  /**
   * Validates if a transition from currentStatus to newStatus is allowed
   *
   * @param currentStatus - The custody's current status
   * @param newStatus - The desired new status
   * @throws BadRequestException if transition is invalid
   * @returns true if transition is valid
   *
   * @example
   * // Valid transition
   * CustodyStatusTransitionValidator.validate('ACTIVE', 'RETURNED'); // ✓
   *
   * // Invalid transition (terminal state)
   * CustodyStatusTransitionValidator.validate('RETURNED', 'ACTIVE'); // ✗
   *
   * // Invalid transition (no-op)
   * CustodyStatusTransitionValidator.validate('ACTIVE', 'ACTIVE'); // ✗
   */
  static validate(
    currentStatus: CustodyStatus,
    newStatus: CustodyStatus,
  ): boolean {
    // Check for no-op (same status)
    if (currentStatus === newStatus) {
      throw new BadRequestException(
        `Custody status is already ${currentStatus}. No transition needed.`,
      );
    }

    // Check if valid status values
    if (!Object.values(CustodyStatus).includes(currentStatus)) {
      throw new BadRequestException(`Invalid current status: ${currentStatus}`);
    }
    if (!Object.values(CustodyStatus).includes(newStatus)) {
      throw new BadRequestException(`Invalid new status: ${newStatus}`);
    }

    // Check if current status is terminal
    if (this.isTerminalState(currentStatus)) {
      throw new BadRequestException(
        `Cannot change status from ${currentStatus}. This is a terminal state and cannot be modified.`,
      );
    }

    // Check standard allowed transitions
    const allowedTransitions =
      CustodyStatusTransitionValidator.ALLOWED_TRANSITIONS[currentStatus] || [];
    const isAllowedTransition = allowedTransitions.includes(newStatus);

    if (isAllowedTransition) {
      return true;
    }

    // Invalid transition
    throw new BadRequestException(
      `Cannot change status from ${currentStatus} to ${newStatus}. This transition is not allowed.`,
    );
  }

  /**
   * Check if a status is a terminal state (immutable)
   *
   * @param status - The custody status to check
   * @returns true if the status is terminal
   */
  static isTerminalState(status: CustodyStatus): boolean {
    return (
      status === CustodyStatus.RETURNED ||
      status === CustodyStatus.CANCELLED ||
      status === CustodyStatus.VIOLATION
    );
  }

  /**
   * Get all allowed transitions from a given status
   *
   * @param currentStatus - The custody's current status
   * @returns Array of allowed target statuses
   */
  static getAllowedTransitions(currentStatus: CustodyStatus): CustodyStatus[] {
    return this.ALLOWED_TRANSITIONS[currentStatus] || [];
  }

  /**
   * Check if a transition is valid (does not throw)
   * Useful for conditional logic instead of try-catch
   *
   * @param currentStatus - The custody's current status
   * @param newStatus - The desired new status
   * @returns true if transition is valid, false otherwise
   */
  static isTransitionValid(
    currentStatus: CustodyStatus,
    newStatus: CustodyStatus,
  ): boolean {
    try {
      return this.validate(currentStatus, newStatus);
    } catch {
      return false;
    }
  }

  /**
   * Get detailed transition information
   * Useful for UI feedback and documentation
   */
  static getTransitionInfo(currentStatus: CustodyStatus) {
    return {
      currentStatus,
      allowedTransitions: this.ALLOWED_TRANSITIONS[currentStatus] || [],
      isTerminal: this.isTerminalState(currentStatus),
      description: this.getStatusDescription(currentStatus),
    };
  }

  /**
   * Get human-readable description for a status
   */
  private static getStatusDescription(status: CustodyStatus): string {
    const descriptions: Record<CustodyStatus, string> = {
      ACTIVE: 'Custody is currently active',
      RETURNED: 'Pet has been returned from custody',
      CANCELLED: 'Custody was cancelled',
      VIOLATION: 'Custody ended due to trust violation',
    };
    return descriptions[status];
  }
}
