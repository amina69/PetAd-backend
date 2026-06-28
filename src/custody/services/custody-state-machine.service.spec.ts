import { Test, TestingModule } from '@nestjs/testing';
import { CustodyStateMachine } from './custody-state-machine.service';
import { CustodyStatus } from '@prisma/client';
import { DomainException } from '../../common/exceptions/domain.exception';

describe('CustodyStateMachine', () => {
  let machine: CustodyStateMachine;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CustodyStateMachine],
    }).compile();

    machine = module.get<CustodyStateMachine>(CustodyStateMachine);
  });

  // ─── Valid Transitions ────────────────────────────────

  describe('valid transitions', () => {
    const validCases: [CustodyStatus, CustodyStatus][] = [
      // PENDING → ACTIVE / CANCELLED
      [CustodyStatus.PENDING, CustodyStatus.ACTIVE],
      [CustodyStatus.PENDING, CustodyStatus.CANCELLED],
      // ACTIVE → RETURNED / CANCELLED / VIOLATION
      [CustodyStatus.ACTIVE, CustodyStatus.RETURNED],
      [CustodyStatus.ACTIVE, CustodyStatus.CANCELLED],
      [CustodyStatus.ACTIVE, CustodyStatus.VIOLATION],
    ];

    test.each(validCases)(
      'allows transition from %s to %s',
      (from, to) => {
        expect(machine.canTransition(from, to)).toBe(true);
        expect(() => machine.assertCanTransition(from, to)).not.toThrow();
      },
    );
  });

  // ─── Invalid Transitions ──────────────────────────────

  describe('invalid transitions', () => {
    const invalidCases: [CustodyStatus, CustodyStatus][] = [
      // Terminal states — no outgoing transitions
      [CustodyStatus.RETURNED, CustodyStatus.ACTIVE],
      [CustodyStatus.RETURNED, CustodyStatus.CANCELLED],
      [CustodyStatus.RETURNED, CustodyStatus.VIOLATION],
      [CustodyStatus.RETURNED, CustodyStatus.PENDING],
      [CustodyStatus.CANCELLED, CustodyStatus.ACTIVE],
      [CustodyStatus.CANCELLED, CustodyStatus.RETURNED],
      [CustodyStatus.CANCELLED, CustodyStatus.VIOLATION],
      [CustodyStatus.CANCELLED, CustodyStatus.PENDING],
      [CustodyStatus.VIOLATION, CustodyStatus.ACTIVE],
      [CustodyStatus.VIOLATION, CustodyStatus.RETURNED],
      [CustodyStatus.VIOLATION, CustodyStatus.CANCELLED],
      [CustodyStatus.VIOLATION, CustodyStatus.PENDING],
      // PENDING → RETURNED/VIOLATION (skip ACTIVE)
      [CustodyStatus.PENDING, CustodyStatus.RETURNED],
      [CustodyStatus.PENDING, CustodyStatus.VIOLATION],
      // Self transitions
      [CustodyStatus.PENDING, CustodyStatus.PENDING],
      [CustodyStatus.ACTIVE, CustodyStatus.ACTIVE],
      [CustodyStatus.RETURNED, CustodyStatus.RETURNED],
      [CustodyStatus.CANCELLED, CustodyStatus.CANCELLED],
      [CustodyStatus.VIOLATION, CustodyStatus.VIOLATION],
    ];

    test.each(invalidCases)(
      'rejects transition from %s to %s',
      (from, to) => {
        expect(machine.canTransition(from, to)).toBe(false);
        expect(() => machine.assertCanTransition(from, to)).toThrow(
          DomainException,
        );
      },
    );
  });

  // ─── assertCanTransition Error Message ────────────────

  it('throws DomainException with descriptive message on invalid transition', () => {
    expect.hasAssertions();

    try {
      machine.assertCanTransition(CustodyStatus.RETURNED, CustodyStatus.ACTIVE);
    } catch (error) {
      expect(error).toBeInstanceOf(DomainException);
      expect((error as DomainException).getStatus()).toBe(422);
      expect((error as DomainException).message).toContain('RETURNED');
      expect((error as DomainException).message).toContain('ACTIVE');
    }
  });

  // ─── getValidTransitions ──────────────────────────────

  describe('getValidTransitions', () => {
    it('returns correct transitions for PENDING', () => {
      const transitions = machine.getValidTransitions(CustodyStatus.PENDING);
      expect(transitions).toEqual([
        CustodyStatus.ACTIVE,
        CustodyStatus.CANCELLED,
      ]);
    });

    it('returns correct transitions for ACTIVE', () => {
      const transitions = machine.getValidTransitions(CustodyStatus.ACTIVE);
      expect(transitions).toEqual([
        CustodyStatus.RETURNED,
        CustodyStatus.CANCELLED,
        CustodyStatus.VIOLATION,
      ]);
    });

    it('returns empty array for terminal state RETURNED', () => {
      const transitions = machine.getValidTransitions(CustodyStatus.RETURNED);
      expect(transitions).toEqual([]);
    });

    it('returns empty array for terminal state CANCELLED', () => {
      const transitions = machine.getValidTransitions(CustodyStatus.CANCELLED);
      expect(transitions).toEqual([]);
    });

    it('returns empty array for terminal state VIOLATION', () => {
      const transitions = machine.getValidTransitions(CustodyStatus.VIOLATION);
      expect(transitions).toEqual([]);
    });
  });

  // ─── getTransitionsMap ────────────────────────────────

  it('returns a frozen transitions map with all statuses', () => {
    const map = machine.getTransitionsMap();
    expect(map).toBeDefined();
    expect(map[CustodyStatus.PENDING]).toContain(CustodyStatus.ACTIVE);
    expect(map[CustodyStatus.PENDING]).toContain(CustodyStatus.CANCELLED);
    expect(map[CustodyStatus.ACTIVE]).toContain(CustodyStatus.RETURNED);
    expect(map[CustodyStatus.ACTIVE]).toContain(CustodyStatus.CANCELLED);
    expect(map[CustodyStatus.ACTIVE]).toContain(CustodyStatus.VIOLATION);
    expect(map[CustodyStatus.RETURNED]).toHaveLength(0);
    expect(map[CustodyStatus.CANCELLED]).toHaveLength(0);
    expect(map[CustodyStatus.VIOLATION]).toHaveLength(0);
  });

  // ─── Terminal States ──────────────────────────────────

  describe('terminal states are immutable', () => {
    const terminalStates = [
      CustodyStatus.RETURNED,
      CustodyStatus.CANCELLED,
      CustodyStatus.VIOLATION,
    ];

    test.each(terminalStates)('%s has no outgoing transitions', (status) => {
      expect(machine.getValidTransitions(status)).toHaveLength(0);
    });
  });

  // ─── Error Message Consistency ────────────────────────

  it('provides consistent error messages for different invalid transitions', () => {
    const testCases = [
      [CustodyStatus.RETURNED, CustodyStatus.ACTIVE],
      [CustodyStatus.CANCELLED, CustodyStatus.PENDING],
      [CustodyStatus.VIOLATION, CustodyStatus.RETURNED],
    ];

    testCases.forEach(([from, to]) => {
      try {
        machine.assertCanTransition(from, to);
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(DomainException);
        const msg = (error as DomainException).message;
        expect(msg).toContain(from);
        expect(msg).toContain(to);
        expect(msg).toContain('Allowed transitions');
      }
    });
  });
});
