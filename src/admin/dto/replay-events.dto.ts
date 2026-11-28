import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Body of `POST /admin/replay/:aggregateId`.
 *
 * - `dryRun` defaults to `true` for safety. To apply corrected state to
 *   the DB, set `dryRun: false` AND `confirm: true`. The explicit confirm
 *   flag is required so admins can't accidentally rewrite DB state by
 *   toggling dryRun alone.
 * - `upToSequence` (optional) limits replay to the first N events for
 *   that aggregate (index-based; events are ordered by `createdAt ASC`).
 */
export class ReplayEventsDto {
  @ApiProperty({
    description:
      'If true (default), only compute replayed state — no DB writes. ' +
      'If false, applies corrected state to the DB (requires `confirm: true`).',
    default: true,
    required: false,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  dryRun?: boolean = true;

  @ApiProperty({
    description:
      'Required when `dryRun: false`. Confirms the admin intends to mutate ' +
      'DB state. Without it, the endpoint returns 400.',
    default: false,
    required: false,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  confirm?: boolean = false;

  @ApiProperty({
    description:
      'Required when `dryRun: false`. A reason for applying the replay.',
    required: false,
  })
  @IsOptional()
  reason?: string;

  @ApiProperty({
    description:
      'Optional. Replay only the first N events for this aggregate ' +
      '(index-based; events are ordered by createdAt ASC).',
    required: false,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  upToSequence?: number;
}
