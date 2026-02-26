import { BadRequestException } from '@nestjs/common';
import { CustodyStatusTransitionValidator } from './custody-status-transition.validator';
import { CustodyStatus } from '@prisma/client';

describe('CustodyStatusTransitionValidator', () => {
  describe('validate - Valid Transitions', () => {
    it('should allow ACTIVE → RETURNED', () => {
      expect(() =>
        CustodyStatusTransitionValidator.validate(
          CustodyStatus.ACTIVE,
          CustodyStatus.RETURNED,
        ),
      ).not.toThrow();
    });

    it('should allow ACTIVE → CANCELLED', () => {
      expect(() =>
        CustodyStatusTransitionValidator.validate(
          CustodyStatus.ACTIVE,
          CustodyStatus.CANCELLED,
        ),
      ).not.toThrow();
    });

    it('should allow ACTIVE → VIOLATION', () => {
      expect(() =>
        CustodyStatusTransitionValidator.validate(
          CustodyStatus.ACTIVE,
          CustodyStatus.VIOLATION,
        ),
      ).not.toThrow();
    });
  });

  describe('validate - Terminal State Immutability', () => {
    it('should block RETURNED → ACTIVE', () => {
      expect(() =>
        CustodyStatusTransitionValidator.validate(
          CustodyStatus.RETURNED,
          CustodyStatus.ACTIVE,
        ),
      ).toThrow(BadRequestException);
    });

    it('should block RETURNED → CANCELLED', () => {
      expect(() =>
        CustodyStatusTransitionValidator.validate(
          CustodyStatus.RETURNED,
          CustodyStatus.CANCELLED,
        ),
      ).toThrow(BadRequestException);
    });

    it('should block RETURNED → VIOLATION', () => {
      expect(() =>
        CustodyStatusTransitionValidator.validate(
          CustodyStatus.RETURNED,
          CustodyStatus.VIOLATION,
        ),
      ).toThrow(BadRequestException);
    });

    it('should block CANCELLED → ACTIVE', () => {
      expect(() =>
        CustodyStatusTransitionValidator.validate(
          CustodyStatus.CANCELLED,
          CustodyStatus.ACTIVE,
        ),
      ).toThrow(BadRequestException);
    });

    it('should block CANCELLED → RETURNED', () => {
      expect(() =>
        CustodyStatusTransitionValidator.validate(
          CustodyStatus.CANCELLED,
          CustodyStatus.RETURNED,
        ),
      ).toThrow(BadRequestException);
    });

    it('should block CANCELLED → VIOLATION', () => {
      expect(() =>
        CustodyStatusTransitionValidator.validate(
          CustodyStatus.CANCELLED,
          CustodyStatus.VIOLATION,
        ),
      ).toThrow(BadRequestException);
    });

    it('should block VIOLATION → ACTIVE', () => {
      expect(() =>
        CustodyStatusTransitionValidator.validate(
          CustodyStatus.VIOLATION,
          CustodyStatus.ACTIVE,
        ),
      ).toThrow(BadRequestException);
    });

    it('should block VIOLATION → RETURNED', () => {
      expect(() =>
        CustodyStatusTransitionValidator.validate(
          CustodyStatus.VIOLATION,
          CustodyStatus.RETURNED,
        ),
      ).toThrow(BadRequestException);
    });

    it('should block VIOLATION → CANCELLED', () => {
      expect(() =>
        CustodyStatusTransitionValidator.validate(
          CustodyStatus.VIOLATION,
          CustodyStatus.CANCELLED,
        ),
      ).toThrow(BadRequestException);
    });
  });

  describe('validate - No-Op Transitions', () => {
    it('should block same status update (ACTIVE → ACTIVE)', () => {
      expect(() =>
        CustodyStatusTransitionValidator.validate(
          CustodyStatus.ACTIVE,
          CustodyStatus.ACTIVE,
        ),
      ).toThrow(BadRequestException);
    });

    it('should block same status update (RETURNED → RETURNED)', () => {
      expect(() =>
        CustodyStatusTransitionValidator.validate(
          CustodyStatus.RETURNED,
          CustodyStatus.RETURNED,
        ),
      ).toThrow(BadRequestException);
    });

    it('should block same status update (CANCELLED → CANCELLED)', () => {
      expect(() =>
        CustodyStatusTransitionValidator.validate(
          CustodyStatus.CANCELLED,
          CustodyStatus.CANCELLED,
        ),
      ).toThrow(BadRequestException);
    });

    it('should block same status update (VIOLATION → VIOLATION)', () => {
      expect(() =>
        CustodyStatusTransitionValidator.validate(
          CustodyStatus.VIOLATION,
          CustodyStatus.VIOLATION,
        ),
      ).toThrow(BadRequestException);
    });
  });

  describe('validate - Error Messages', () => {
    it('should provide clear error message for terminal state transitions', () => {
      try {
        CustodyStatusTransitionValidator.validate(
          CustodyStatus.RETURNED,
          CustodyStatus.ACTIVE,
        );
        fail('Should have thrown');
      } catch (error) {
        if (error instanceof Error) {
          expect(error.message).toContain('RETURNED');
          expect(error.message).toContain('terminal state');
          expect(error.message).toContain('cannot be modified');
        } else {
          throw error;
        }
      }
    });

    it('should provide clear error message for invalid transitions', () => {
      try {
        CustodyStatusTransitionValidator.validate(
          CustodyStatus.CANCELLED,
          CustodyStatus.RETURNED,
        );
        fail('Should have thrown');
      } catch (error) {
        if (error instanceof Error) {
          expect(error.message).toContain('terminal state');
        } else {
          throw error;
        }
      }
    });

    it('should mention same status in error for no-op', () => {
      try {
        CustodyStatusTransitionValidator.validate(
          CustodyStatus.ACTIVE,
          CustodyStatus.ACTIVE,
        );
        fail('Should have thrown');
      } catch (error) {
        if (error instanceof Error) {
          expect(error.message).toContain('already');
        } else {
          throw error;
        }
      }
    });
  });

  describe('isTerminalState', () => {
    it('should identify RETURNED as terminal', () => {
      expect(
        CustodyStatusTransitionValidator.isTerminalState(
          CustodyStatus.RETURNED,
        ),
      ).toBe(true);
    });

    it('should identify CANCELLED as terminal', () => {
      expect(
        CustodyStatusTransitionValidator.isTerminalState(
          CustodyStatus.CANCELLED,
        ),
      ).toBe(true);
    });

    it('should identify VIOLATION as terminal', () => {
      expect(
        CustodyStatusTransitionValidator.isTerminalState(
          CustodyStatus.VIOLATION,
        ),
      ).toBe(true);
    });

    it('should identify ACTIVE as non-terminal', () => {
      expect(
        CustodyStatusTransitionValidator.isTerminalState(CustodyStatus.ACTIVE),
      ).toBe(false);
    });
  });

  describe('getAllowedTransitions', () => {
    it('should return correct transitions for ACTIVE status', () => {
      const transitions =
        CustodyStatusTransitionValidator.getAllowedTransitions(
          CustodyStatus.ACTIVE,
        );

      expect(transitions).toContain(CustodyStatus.RETURNED);
      expect(transitions).toContain(CustodyStatus.CANCELLED);
      expect(transitions).toContain(CustodyStatus.VIOLATION);
      expect(transitions).toHaveLength(3);
    });

    it('should return empty array for RETURNED status', () => {
      const transitions =
        CustodyStatusTransitionValidator.getAllowedTransitions(
          CustodyStatus.RETURNED,
        );

      expect(transitions).toEqual([]);
    });

    it('should return empty array for CANCELLED status', () => {
      const transitions =
        CustodyStatusTransitionValidator.getAllowedTransitions(
          CustodyStatus.CANCELLED,
        );

      expect(transitions).toEqual([]);
    });

    it('should return empty array for VIOLATION status', () => {
      const transitions =
        CustodyStatusTransitionValidator.getAllowedTransitions(
          CustodyStatus.VIOLATION,
        );

      expect(transitions).toEqual([]);
    });
  });

  describe('isTransitionValid', () => {
    it('should return true for valid transitions', () => {
      expect(
        CustodyStatusTransitionValidator.isTransitionValid(
          CustodyStatus.ACTIVE,
          CustodyStatus.RETURNED,
        ),
      ).toBe(true);

      expect(
        CustodyStatusTransitionValidator.isTransitionValid(
          CustodyStatus.ACTIVE,
          CustodyStatus.CANCELLED,
        ),
      ).toBe(true);

      expect(
        CustodyStatusTransitionValidator.isTransitionValid(
          CustodyStatus.ACTIVE,
          CustodyStatus.VIOLATION,
        ),
      ).toBe(true);
    });

    it('should return false for invalid transitions', () => {
      expect(
        CustodyStatusTransitionValidator.isTransitionValid(
          CustodyStatus.RETURNED,
          CustodyStatus.ACTIVE,
        ),
      ).toBe(false);

      expect(
        CustodyStatusTransitionValidator.isTransitionValid(
          CustodyStatus.CANCELLED,
          CustodyStatus.ACTIVE,
        ),
      ).toBe(false);

      expect(
        CustodyStatusTransitionValidator.isTransitionValid(
          CustodyStatus.VIOLATION,
          CustodyStatus.ACTIVE,
        ),
      ).toBe(false);
    });

    it('should return false for no-op transitions', () => {
      expect(
        CustodyStatusTransitionValidator.isTransitionValid(
          CustodyStatus.ACTIVE,
          CustodyStatus.ACTIVE,
        ),
      ).toBe(false);

      expect(
        CustodyStatusTransitionValidator.isTransitionValid(
          CustodyStatus.RETURNED,
          CustodyStatus.RETURNED,
        ),
      ).toBe(false);
    });

    it('should return false for terminal state transitions', () => {
      expect(
        CustodyStatusTransitionValidator.isTransitionValid(
          CustodyStatus.RETURNED,
          CustodyStatus.CANCELLED,
        ),
      ).toBe(false);

      expect(
        CustodyStatusTransitionValidator.isTransitionValid(
          CustodyStatus.CANCELLED,
          CustodyStatus.VIOLATION,
        ),
      ).toBe(false);
    });
  });

  describe('getTransitionInfo', () => {
    it('should return transition info for ACTIVE status', () => {
      const info = CustodyStatusTransitionValidator.getTransitionInfo(
        CustodyStatus.ACTIVE,
      );

      expect(info).toHaveProperty('currentStatus', CustodyStatus.ACTIVE);
      expect(info).toHaveProperty('allowedTransitions');
      expect(info).toHaveProperty('isTerminal', false);
      expect(info).toHaveProperty('description');
      expect(info.allowedTransitions).toHaveLength(3);
    });

    it('should return transition info for terminal states', () => {
      const returnedInfo = CustodyStatusTransitionValidator.getTransitionInfo(
        CustodyStatus.RETURNED,
      );

      expect(returnedInfo.isTerminal).toBe(true);
      expect(returnedInfo.allowedTransitions).toEqual([]);

      const cancelledInfo = CustodyStatusTransitionValidator.getTransitionInfo(
        CustodyStatus.CANCELLED,
      );

      expect(cancelledInfo.isTerminal).toBe(true);
      expect(cancelledInfo.allowedTransitions).toEqual([]);

      const violationInfo = CustodyStatusTransitionValidator.getTransitionInfo(
        CustodyStatus.VIOLATION,
      );

      expect(violationInfo.isTerminal).toBe(true);
      expect(violationInfo.allowedTransitions).toEqual([]);
    });

    it('should provide human-readable description', () => {
      const info = CustodyStatusTransitionValidator.getTransitionInfo(
        CustodyStatus.ACTIVE,
      );

      expect(info.description).toBeTruthy();
      expect(typeof info.description).toBe('string');
    });
  });

  describe('Edge Cases', () => {
    it('should handle all CustodyStatus enum values', () => {
      Object.values(CustodyStatus).forEach((status) => {
        expect(() =>
          CustodyStatusTransitionValidator.getTransitionInfo(
            status as CustodyStatus,
          ),
        ).not.toThrow();
      });
    });

    it('should not allow duplicate transitions in getAllowedTransitions', () => {
      const transitions =
        CustodyStatusTransitionValidator.getAllowedTransitions(
          CustodyStatus.ACTIVE,
        );

      // Using Set to check for duplicates
      expect(new Set(transitions).size).toBe(transitions.length);
    });
  });
});
