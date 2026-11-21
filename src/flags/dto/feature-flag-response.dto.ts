import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

export class EvaluatedFlagsDto {
  @ApiProperty({
    description:
      'Map of known flag keys to their evaluated value for the caller. ' +
      'Unknown keys are omitted and disabled flags evaluate to false.',
    example: { 'new-adoption-flow': true },
    additionalProperties: { type: 'boolean' },
  })
  flags!: Record<string, boolean>;
}

export class FeatureFlagDto {
  @ApiProperty() id!: string;
  @ApiProperty() key!: string;
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ minimum: 0, maximum: 100 }) rolloutPercentage!: number;
  @ApiProperty({ enum: UserRole, isArray: true }) targetRoles!: UserRole[];
  @ApiPropertyOptional({ nullable: true }) description?: string | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}
