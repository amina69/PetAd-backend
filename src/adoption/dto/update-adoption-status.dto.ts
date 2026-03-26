import { IsEnum } from 'class-validator';
import { AdoptionStatus } from '@prisma/client';

// Only statuses that can be set by an actor explicitly.
// REQUESTED is set on creation; ESCROW_FUNDED is set by the escrow module.
const ALLOWED_STATUSES = [
  AdoptionStatus.APPROVED,
  AdoptionStatus.COMPLETED,
  AdoptionStatus.REJECTED,
  AdoptionStatus.CANCELLED,
] as const;

type AllowedStatus = (typeof ALLOWED_STATUSES)[number];

export class UpdateAdoptionStatusDto {
  @IsEnum(ALLOWED_STATUSES, {
    message: `status must be one of: ${ALLOWED_STATUSES.join(', ')}`,
  })
  status: AllowedStatus;
}
