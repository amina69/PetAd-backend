import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/exceptions/error-codes';
import { PetStatus } from '../../common/enums/pet-status.enum';

export const PET_STATUS_TRANSITIONS: Readonly<
  Record<PetStatus, readonly PetStatus[]>
> = {
  [PetStatus.AVAILABLE]: [PetStatus.PENDING, PetStatus.IN_CUSTODY],
  [PetStatus.PENDING]: [PetStatus.AVAILABLE, PetStatus.ADOPTED],
  [PetStatus.IN_CUSTODY]: [PetStatus.AVAILABLE],
  [PetStatus.ADOPTED]: [PetStatus.AVAILABLE],
};

export function canTransitionPetStatus(
  fromStatus: PetStatus,
  toStatus: PetStatus,
): boolean {
  return PET_STATUS_TRANSITIONS[fromStatus].includes(toStatus);
}

export function assertPetStatus(
  currentStatus: PetStatus,
  expectedStatus: PetStatus,
): void {
  if (currentStatus === expectedStatus) {
    return;
  }

  throw new AppException(
    ErrorCode.PET_INVALID_TRANSITION,
    `Expected pet status ${expectedStatus}, found ${currentStatus}`,
    HttpStatus.UNPROCESSABLE_ENTITY,
    {
      fromStatus: currentStatus,
      toStatus: expectedStatus,
      allowedTransitions: PET_STATUS_TRANSITIONS[currentStatus],
    },
  );
}

export function assertPetStatusTransition(
  fromStatus: PetStatus,
  toStatus: PetStatus,
): void {
  if (canTransitionPetStatus(fromStatus, toStatus)) {
    return;
  }

  throw new AppException(
    ErrorCode.PET_INVALID_TRANSITION,
    `Invalid pet status transition: ${fromStatus} -> ${toStatus}`,
    HttpStatus.UNPROCESSABLE_ENTITY,
    {
      fromStatus,
      toStatus,
      allowedTransitions: PET_STATUS_TRANSITIONS[fromStatus],
    },
  );
}

export function transitionPetStatus(
  fromStatus: PetStatus,
  toStatus: PetStatus,
): PetStatus {
  assertPetStatusTransition(fromStatus, toStatus);
  return toStatus;
}
