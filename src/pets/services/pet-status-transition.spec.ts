import { PetStatus } from '../../common/enums/pet-status.enum';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/exceptions/error-codes';
import {
  canTransitionPetStatus,
  PET_STATUS_TRANSITIONS,
  transitionPetStatus,
} from './pet-status-transition';

describe('pet status transition table', () => {
  const states = Object.values(PetStatus);

  it.each(
    states.flatMap((fromStatus) =>
      states.map((toStatus) => [fromStatus, toStatus] as const),
    ),
  )('evaluates every pair: %s -> %s', (fromStatus, toStatus) => {
    const allowed = PET_STATUS_TRANSITIONS[fromStatus].includes(toStatus);

    expect(canTransitionPetStatus(fromStatus, toStatus)).toBe(allowed);

    if (allowed) {
      expect(transitionPetStatus(fromStatus, toStatus)).toBe(toStatus);
    } else {
      let error: unknown;
      try {
        transitionPetStatus(fromStatus, toStatus);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).code).toBe(
        ErrorCode.PET_INVALID_TRANSITION,
      );
    }
  });
});
