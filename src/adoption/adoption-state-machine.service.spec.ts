import { Test, TestingModule } from '@nestjs/testing';
import { AdoptionStateMachine, AdoptionStatus, DomainException } from './adoption-state-machine.service';

describe('AdoptionStateMachine', () => {
  let stateMachine: AdoptionStateMachine;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AdoptionStateMachine],
    }).compile();

    stateMachine = module.get<AdoptionStateMachine>(AdoptionStateMachine);
  });

  describe('canTransition', () => {
    it('should allow valid transitions', () => {
      expect(stateMachine.canTransition(AdoptionStatus.REQUESTED, AdoptionStatus.PENDING_REVIEW)).toBe(true);
      expect(stateMachine.canTransition(AdoptionStatus.REQUESTED, AdoptionStatus.REJECTED)).toBe(true);
    });

    it('should block invalid transitions', () => {
      expect(stateMachine.canTransition(AdoptionStatus.COMPLETED, AdoptionStatus.PENDING_REVIEW)).toBe(false);
      expect(stateMachine.canTransition(AdoptionStatus.REJECTED, AdoptionStatus.APPROVED)).toBe(false);
    });

    it('should handle all status transitions correctly', () => {
      // Test all defined valid transitions
      const validTransitions = [
        { from: AdoptionStatus.REQUESTED, to: AdoptionStatus.PENDING_REVIEW },
        { from: AdoptionStatus.REQUESTED, to: AdoptionStatus.REJECTED },
        { from: AdoptionStatus.PENDING_REVIEW, to: AdoptionStatus.APPROVED },
        { from: AdoptionStatus.PENDING_REVIEW, to: AdoptionStatus.REJECTED },
        { from: AdoptionStatus.PENDING, to: AdoptionStatus.APPROVED },
        { from: AdoptionStatus.PENDING, to: AdoptionStatus.REJECTED },
        { from: AdoptionStatus.APPROVED, to: AdoptionStatus.ESCROW_FUNDED },
        { from: AdoptionStatus.APPROVED, to: AdoptionStatus.CANCELLED },
        { from: AdoptionStatus.ESCROW_FUNDED, to: AdoptionStatus.COMPLETED },
        { from: AdoptionStatus.ESCROW_FUNDED, to: AdoptionStatus.REFUNDED },
      ];

      validTransitions.forEach(({ from, to }) => {
        expect(stateMachine.canTransition(from, to)).toBe(true);
      });
    });
  });

  describe('validateTransition', () => {
    it('should not throw for valid transitions', () => {
      expect(() => {
        stateMachine.validateTransition(AdoptionStatus.REQUESTED, AdoptionStatus.PENDING_REVIEW);
      }).not.toThrow();
    });

    it('should throw DomainException for invalid transitions', () => {
      expect(() => {
        stateMachine.validateTransition(AdoptionStatus.COMPLETED, AdoptionStatus.PENDING_REVIEW);
      }).toThrow(DomainException);
    });

    it('should include valid transitions in error message', () => {
      try {
        stateMachine.validateTransition(AdoptionStatus.REQUESTED, AdoptionStatus.APPROVED);
      } catch (error) {
        expect(error.message).toContain('Invalid adoption status transition');
        expect(error.message).toContain('REQUESTED → APPROVED');
        expect(error.message).toContain('PENDING_REVIEW, REJECTED');
      }
    });
  });

  describe('getValidTransitions', () => {
    it('should return all valid transitions from a status', () => {
      const transitions = stateMachine.getValidTransitions(AdoptionStatus.REQUESTED);
      expect(transitions).toEqual([AdoptionStatus.PENDING_REVIEW, AdoptionStatus.REJECTED]);
    });

    it('should return empty array for terminal states', () => {
      const transitions = stateMachine.getValidTransitions(AdoptionStatus.COMPLETED);
      expect(transitions).toEqual([]);
    });
  });

  describe('isTerminalStatus', () => {
    it('should identify terminal states correctly', () => {
      expect(stateMachine.isTerminalStatus(AdoptionStatus.COMPLETED)).toBe(true);
      expect(stateMachine.isTerminalStatus(AdoptionStatus.REJECTED)).toBe(true);
      expect(stateMachine.isTerminalStatus(AdoptionStatus.CANCELLED)).toBe(true);
      expect(stateMachine.isTerminalStatus(AdoptionStatus.REFUNDED)).toBe(true);
    });

    it('should identify non-terminal states correctly', () => {
      expect(stateMachine.isTerminalStatus(AdoptionStatus.REQUESTED)).toBe(false);
      expect(stateMachine.isTerminalStatus(AdoptionStatus.PENDING_REVIEW)).toBe(false);
      expect(stateMachine.isTerminalStatus(AdoptionStatus.APPROVED)).toBe(false);
      expect(stateMachine.isTerminalStatus(AdoptionStatus.ESCROW_FUNDED)).toBe(false);
    });
  });

  describe('canAdminOverride', () => {
    it('should allow all transitions for admins', () => {
      expect(stateMachine.canAdminOverride(AdoptionStatus.REQUESTED, AdoptionStatus.APPROVED, true)).toBe(true);
    });

    it('should respect state machine for non-admins', () => {
      expect(stateMachine.canAdminOverride(AdoptionStatus.REQUESTED, AdoptionStatus.APPROVED, false)).toBe(false);
    });

    it('should prevent reactivating completed adoptions even for admins', () => {
      expect(stateMachine.canAdminOverride(AdoptionStatus.COMPLETED, AdoptionStatus.REQUESTED, true)).toBe(false);
    });

    it('should prevent changing rejected to approved even for admins', () => {
      expect(stateMachine.canAdminOverride(AdoptionStatus.REJECTED, AdoptionStatus.APPROVED, true)).toBe(false);
    });
  });

  describe('canReleaseEscrow', () => {
    it('should allow escrow release only for ESCROW_FUNDED status', () => {
      expect(stateMachine.canReleaseEscrow(AdoptionStatus.ESCROW_FUNDED)).toBe(true);
      expect(stateMachine.canReleaseEscrow(AdoptionStatus.APPROVED)).toBe(false);
      expect(stateMachine.canReleaseEscrow(AdoptionStatus.COMPLETED)).toBe(false);
    });
  });

  describe('canComplete', () => {
    it('should allow completion only for ESCROW_FUNDED status', () => {
      expect(stateMachine.canComplete(AdoptionStatus.ESCROW_FUNDED)).toBe(true);
      expect(stateMachine.canComplete(AdoptionStatus.APPROVED)).toBe(false);
      expect(stateMachine.canComplete(AdoptionStatus.REQUESTED)).toBe(false);
    });
  });

  describe('DomainException', () => {
    it('should create proper error instance', () => {
      const error = new DomainException('Test error');
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('DomainException');
      expect(error.message).toBe('Test error');
    });
  });

  describe('Invalid Transition Prevention', () => {
    it('should prevent COMPLETED → PENDING_REVIEW', () => {
      expect(stateMachine.canTransition(AdoptionStatus.COMPLETED, AdoptionStatus.PENDING_REVIEW)).toBe(false);
    });

    it('should prevent REJECTED → APPROVED', () => {
      expect(stateMachine.canTransition(AdoptionStatus.REJECTED, AdoptionStatus.APPROVED)).toBe(false);
    });

    it('should prevent REFUNDED → COMPLETED', () => {
      expect(stateMachine.canTransition(AdoptionStatus.REFUNDED, AdoptionStatus.COMPLETED)).toBe(false);
    });

    it('should prevent CANCELLED → APPROVED', () => {
      expect(stateMachine.canTransition(AdoptionStatus.CANCELLED, AdoptionStatus.APPROVED)).toBe(false);
    });

    it('should prevent ESCROW_FUNDED → REQUESTED', () => {
      expect(stateMachine.canTransition(AdoptionStatus.ESCROW_FUNDED, AdoptionStatus.REQUESTED)).toBe(false);
    });
  });
});
