import { BadRequestException } from '@nestjs/common';
import { CustodyStatus } from '@prisma/client';
import { CustodyStateMachine } from './custody-state-machine.service';

describe('CustodyStateMachine', () => {
  let sm: CustodyStateMachine;

  beforeEach(() => {
    sm = new CustodyStateMachine();
  });

  // ─── canTransition ────────────────────────────────────────────────────────

  describe('canTransition()', () => {
    // Valid transitions
    it('allows PENDING → ACTIVE', () => {
      expect(sm.canTransition(CustodyStatus.PENDING, CustodyStatus.ACTIVE)).toBe(true);
    });

    it('allows PENDING → CANCELLED', () => {
      expect(sm.canTransition(CustodyStatus.PENDING, CustodyStatus.CANCELLED)).toBe(true);
    });

    it('allows ACTIVE → RETURNED', () => {
      expect(sm.canTransition(CustodyStatus.ACTIVE, CustodyStatus.RETURNED)).toBe(true);
    });

    it('allows ACTIVE → CANCELLED', () => {
      expect(sm.canTransition(CustodyStatus.ACTIVE, CustodyStatus.CANCELLED)).toBe(true);
    });

    it('allows ACTIVE → VIOLATION', () => {
      expect(sm.canTransition(CustodyStatus.ACTIVE, CustodyStatus.VIOLATION)).toBe(true);
    });

    // Invalid transitions — terminal states are immutable
    it('blocks RETURNED → ACTIVE', () => {
      expect(sm.canTransition(CustodyStatus.RETURNED, CustodyStatus.ACTIVE)).toBe(false);
    });

    it('blocks RETURNED → CANCELLED', () => {
      expect(sm.canTransition(CustodyStatus.RETURNED, CustodyStatus.CANCELLED)).toBe(false);
    });

    it('blocks CANCELLED → ACTIVE', () => {
      expect(sm.canTransition(CustodyStatus.CANCELLED, CustodyStatus.ACTIVE)).toBe(false);
    });

    it('blocks VIOLATION → ACTIVE', () => {
      expect(sm.canTransition(CustodyStatus.VIOLATION, CustodyStatus.ACTIVE)).toBe(false);
    });

    it('blocks VIOLATION → RETURNED', () => {
      expect(sm.canTransition(CustodyStatus.VIOLATION, CustodyStatus.RETURNED)).toBe(false);
    });

    // Invalid forward jumps
    it('blocks PENDING → RETURNED (must go through ACTIVE)', () => {
      expect(sm.canTransition(CustodyStatus.PENDING, CustodyStatus.RETURNED)).toBe(false);
    });

    it('blocks PENDING → VIOLATION (must go through ACTIVE)', () => {
      expect(sm.canTransition(CustodyStatus.PENDING, CustodyStatus.VIOLATION)).toBe(false);
    });

    // Self-transitions are invalid
    it('blocks ACTIVE → ACTIVE (self-transition)', () => {
      expect(sm.canTransition(CustodyStatus.ACTIVE, CustodyStatus.ACTIVE)).toBe(false);
    });

    it('blocks PENDING → PENDING (self-transition)', () => {
      expect(sm.canTransition(CustodyStatus.PENDING, CustodyStatus.PENDING)).toBe(false);
    });
  });

  // ─── assertTransition ─────────────────────────────────────────────────────

  describe('assertTransition()', () => {
    it('does not throw for valid transition ACTIVE → RETURNED', () => {
      expect(() =>
        sm.assertTransition(CustodyStatus.ACTIVE, CustodyStatus.RETURNED),
      ).not.toThrow();
    });

    it('does not throw for valid transition PENDING → ACTIVE', () => {
      expect(() =>
        sm.assertTransition(CustodyStatus.PENDING, CustodyStatus.ACTIVE),
      ).not.toThrow();
    });

    it('throws BadRequestException for RETURNED → ACTIVE (terminal)', () => {
      expect(() =>
        sm.assertTransition(CustodyStatus.RETURNED, CustodyStatus.ACTIVE),
      ).toThrow(BadRequestException);
    });

    it('error message mentions terminal state when from is terminal', () => {
      expect(() =>
        sm.assertTransition(CustodyStatus.RETURNED, CustodyStatus.ACTIVE),
      ).toThrow(/terminal state/i);
    });

    it('throws BadRequestException for CANCELLED → ACTIVE (terminal)', () => {
      expect(() =>
        sm.assertTransition(CustodyStatus.CANCELLED, CustodyStatus.ACTIVE),
      ).toThrow(BadRequestException);
    });

    it('throws BadRequestException for VIOLATION → ACTIVE (terminal)', () => {
      expect(() =>
        sm.assertTransition(CustodyStatus.VIOLATION, CustodyStatus.ACTIVE),
      ).toThrow(BadRequestException);
    });

    it('throws BadRequestException for PENDING → RETURNED (invalid forward jump)', () => {
      expect(() =>
        sm.assertTransition(CustodyStatus.PENDING, CustodyStatus.RETURNED),
      ).toThrow(BadRequestException);
    });

    it('error message mentions allowed transitions for non-terminal invalid transition', () => {
      expect(() =>
        sm.assertTransition(CustodyStatus.PENDING, CustodyStatus.RETURNED),
      ).toThrow(/ACTIVE|CANCELLED/);
    });
  });

  // ─── getAllowedTransitions ─────────────────────────────────────────────────

  describe('getAllowedTransitions()', () => {
    it('returns [ACTIVE, CANCELLED] for PENDING', () => {
      expect(sm.getAllowedTransitions(CustodyStatus.PENDING)).toEqual(
        expect.arrayContaining([CustodyStatus.ACTIVE, CustodyStatus.CANCELLED]),
      );
      expect(sm.getAllowedTransitions(CustodyStatus.PENDING)).toHaveLength(2);
    });

    it('returns [RETURNED, CANCELLED, VIOLATION] for ACTIVE', () => {
      expect(sm.getAllowedTransitions(CustodyStatus.ACTIVE)).toEqual(
        expect.arrayContaining([
          CustodyStatus.RETURNED,
          CustodyStatus.CANCELLED,
          CustodyStatus.VIOLATION,
        ]),
      );
      expect(sm.getAllowedTransitions(CustodyStatus.ACTIVE)).toHaveLength(3);
    });

    it('returns [] for RETURNED (terminal)', () => {
      expect(sm.getAllowedTransitions(CustodyStatus.RETURNED)).toEqual([]);
    });

    it('returns [] for CANCELLED (terminal)', () => {
      expect(sm.getAllowedTransitions(CustodyStatus.CANCELLED)).toEqual([]);
    });

    it('returns [] for VIOLATION (terminal)', () => {
      expect(sm.getAllowedTransitions(CustodyStatus.VIOLATION)).toEqual([]);
    });

    it('returns a copy — mutation does not affect the state machine', () => {
      const result = sm.getAllowedTransitions(CustodyStatus.ACTIVE);
      result.push(CustodyStatus.PENDING); // mutate the returned array
      // Original should still be 3 items
      expect(sm.getAllowedTransitions(CustodyStatus.ACTIVE)).toHaveLength(3);
    });
  });

  // ─── isTerminal ───────────────────────────────────────────────────────────

  describe('isTerminal()', () => {
    it('returns false for PENDING', () => {
      expect(sm.isTerminal(CustodyStatus.PENDING)).toBe(false);
    });

    it('returns false for ACTIVE', () => {
      expect(sm.isTerminal(CustodyStatus.ACTIVE)).toBe(false);
    });

    it('returns true for RETURNED', () => {
      expect(sm.isTerminal(CustodyStatus.RETURNED)).toBe(true);
    });

    it('returns true for CANCELLED', () => {
      expect(sm.isTerminal(CustodyStatus.CANCELLED)).toBe(true);
    });

    it('returns true for VIOLATION', () => {
      expect(sm.isTerminal(CustodyStatus.VIOLATION)).toBe(true);
    });
  });
});
