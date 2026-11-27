import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsIn, IsOptional } from 'class-validator';

export const ADMIN_STAT_SECTIONS = [
  'pendingApprovals',
  'openDisputes',
  'documentsAwaitingVerification',
  'newUsers',
] as const;

export type AdminStatSection = (typeof ADMIN_STAT_SECTIONS)[number];

function toSectionArray(value: unknown): unknown {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || value === '') return undefined;
  return value
    .split(',')
    .map((section) => section.trim())
    .filter(Boolean);
}

export class AdminStatsQueryDto {
  @ApiProperty({
    required: false,
    enum: ADMIN_STAT_SECTIONS,
    description:
      'Comma-separated sections to return. All sections are returned when omitted.',
    example: 'pendingApprovals,openDisputes',
  })
  @IsOptional()
  @Transform(({ value }) => toSectionArray(value))
  @IsArray()
  @IsIn(ADMIN_STAT_SECTIONS, { each: true })
  include?: AdminStatSection[];
}
