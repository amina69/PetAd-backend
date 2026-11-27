import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsOptional, IsString, Matches } from 'class-validator';

function toKeyArray(value: unknown): unknown {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || value === '') return undefined;
  return value
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
}

export class FeatureFlagsQueryDto {
  @ApiPropertyOptional({
    description:
      'Optional comma-separated keys. Unknown keys are omitted from the response.',
    example: 'new-adoption-flow,fast-checkout',
  })
  @IsOptional()
  @Transform(({ value }) => toKeyArray(value))
  @IsArray()
  @IsString({ each: true })
  @Matches(/^[a-z][a-z0-9._-]{1,63}$/, { each: true })
  keys?: string[];
}
