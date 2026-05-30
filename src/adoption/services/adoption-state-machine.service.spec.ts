import { Test, TestingModule } from '@nestjs/testing';
import { AdoptionStateMachine } from './adoption-state-machine.service';
import { AdoptionStatus } from '@prisma/client';
import { DomainException } from '../../common/exceptions/domain.exception';

describe('AdoptionStateMachine', () => {
  let machine: AdoptionStateMachine;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AdoptionStateMachine],
    }).compile();

    machine = module.get<AdoptionStateMachine>(AdoptionStateMachine);
  });

  // ─── Valid Transitions ────────────────────────────────

  describe('valid transitions', () => {
    const validCases: [AdoptionStatus, AdoptionStatus][] = [
      // REQUESTED → PENDING_REVIEW (PENDING) / REJECTED
      [AdoptionStatus.REQUESTED, AdoptionStatus.PENDING],
      [AdoptionStatus.REQUESTED, AdoptionStatus.REJECTED],
      // PENDING → APPROVED / REJECTED
      [AdoptionStatus.PENDING, AdoptionStatus.APPROVED],
      [AdoptionStatus.PENDING, AdoptionStatus.REJECTED],
      // APPROVED → ESCROW_FUNDED / CANCELLED
      [AdoptionStatus.APPROVED, AdoptionStatus.ESCROW_FUNDED],
      [AdoptionStatus.APPROVED, AdoptionStatus.CANCELLED],
      // ESCROW_FUNDED → COMPLETED / CANCELLED
      [AdoptionStatus.ESCROW_FUNDED, AdoptionStatus.COMPLETED],
      [AdoptionStatus.ESCROW_FUNDED, AdoptionStatus.CANCELLED],
    ];

    test.each(validCases)(
      'allows transition from %s to %s',
      (from, to) => {
        expect(machine.canTransition(from, to)).toBe(true);
        expect(() => machine.assertValidTransition(from, to)).not.toThrow();
      },
    );
  });

  // ─── Invalid Transitions ──────────────────────────────

  describe('invalid transitions', () => {
    const invalidCases: [AdoptionStatus, AdoptionStatus][] = [
      // Terminal states — no outgoing transitions
      [AdoptionStatus.COMPLETED, AdoptionStatus.PENDING],
      [AdoptionStatus.COMPLETED, AdoptionStatus.APPROVED],
      [AdoptionStatus.COMPLETED, AdoptionStatus.ESCROW_FUNDED],
      [AdoptionStatus.COMPLETED, AdoptionStatus.REQUESTED],
      [AdoptionStatus.REJECTED, AdoptionStatus.APPROVED],
      [AdoptionStatus.REJECTED, AdoptionStatus.PENDING],
      [AdoptionStatus.CANCELLED, AdoptionStatus.APPROVED],
      [AdoptionStatus.CANCELLED, AdoptionStatus.PENDING],
      // Skipping stages — backwards
      [AdoptionStatus.APPROVED, AdoptionStatus.REQUESTED],
      [AdoptionStatus.ESCROW_FUNDED, AdoptionStatus.REQUESTED],
      [AdoptionStatus.ESCROW_FUNDED, AdoptionStatus.PENDING],
      [AdoptionStatus.COMPLETED, AdoptionStatus.REJECTED],
      // Direct to final without intermediate
      [AdoptionStatus.REQUESTED, AdoptionStatus.COMPLETED],
      [AdoptionStatus.PENDING, AdoptionStatus.COMPLETED],
      // Self transitions
      [AdoptionStatus.REQUESTED, AdoptionStatus.REQUESTED],
      [AdoptionStatus.APPROVED, AdoptionStatus.APPROVED],
      [AdoptionStatus.COMPLETED, AdoptionStatus.COMPLETED],
      [AdoptionStatus.REJECTED, AdoptionStatus.REJECTED],
      [AdoptionStatus.CANCELLED, AdoptionStatus.CANCELLED],
    ];

    test.each(invalidCases)(
      'rejects transition from %s to %s',
      (from, to) => {
        expect(machine.canTransition(from, to)).toBe(false);
        expect(() => machine.assertValidTransition(from, to)).toThrow(
          DomainException,
        );
      },
    );
  });

  // ─── assertValidTransition Error Message ──────────────

  it('throws DomainException with descriptive message on invalid transition', () => {
    expect.hasAssertions();

    try {
      machine.assertValidTransition(
        AdoptionStatus.REJECTED,
        AdoptionStatus.APPROVED,
      );
    } catch (error) {
      expect(error).toBeInstanceOf(DomainException);
      expect((error as DomainException).getStatus()).toBe(422);
      expect((error as DomainException).message).toContain('REJECTED');
      expect((error as DomainException).message).toContain('APPROVED');
    }
  });

  // ─── getValidTransitions ──────────────────────────────

  it('returns a frozen transitions map', () => {
    const map = machine.getValidTransitions();
    expect(map).toBeDefined();
    expect(map[AdoptionStatus.REQUESTED]).toContain(AdoptionStatus.PENDING);
    expect(map[AdoptionStatus.PENDING]).toContain(AdoptionStatus.APPROVED);
    expect(map[AdoptionStatus.APPROVED]).toContain(AdoptionStatus.ESCROW_FUNDED);
    expect(map[AdoptionStatus.ESCROW_FUNDED]).toContain(AdoptionStatus.COMPLETED);
    expect(map[AdoptionStatus.COMPLETED]).toHaveLength(0);
    expect(map[AdoptionStatus.REJECTED]).toHaveLength(0);
    expect(map[AdoptionStatus.CANCELLED]).toHaveLength(0);
  });
});
