import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const NEW_USERS_WINDOW_DAYS = 7;

export class AdminStatsDto {
  @ApiProperty({
    description: 'Adoption requests in REQUESTED or PENDING state.',
    minimum: 0,
  })
  pendingApprovals: number;

  @ApiProperty({ description: 'Escrows in DISPUTED state.', minimum: 0 })
  openDisputes: number;

  @ApiProperty({
    description: 'Documents with verification status PENDING.',
    minimum: 0,
  })
  documentsAwaitingVerification: number;

  @ApiProperty({
    description: `Non-deleted users created in the last ${NEW_USERS_WINDOW_DAYS} days.`,
    minimum: 0,
  })
  newUsers: number;

  @ApiPropertyOptional({
    description:
      'Lower bound of the new-users window. Present only when newUsers is included.',
  })
  since?: string;

  @ApiProperty({ description: 'Time at which this snapshot was computed.' })
  generatedAt: string;
}
