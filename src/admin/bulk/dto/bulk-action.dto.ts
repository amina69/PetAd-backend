import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export const BULK_ACTION_MAX_ITEMS = 100;

export enum BulkResource {
  ADOPTIONS = 'adoptions',
  DOCUMENTS = 'documents',
  PETS = 'pets',
}

export enum BulkAction {
  APPROVE = 'approve',
  REJECT = 'reject',
  VERIFY = 'verify',
  ARCHIVE = 'archive',
}

export const ALLOWED_BULK_ACTIONS: Record<BulkResource, readonly BulkAction[]> =
  {
    [BulkResource.ADOPTIONS]: [BulkAction.APPROVE, BulkAction.REJECT],
    [BulkResource.DOCUMENTS]: [BulkAction.VERIFY],
    [BulkResource.PETS]: [BulkAction.ARCHIVE],
  };

export class BulkActionDto {
  @ApiProperty({
    type: [String],
    maxItems: BULK_ACTION_MAX_ITEMS,
    example: ['9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(BULK_ACTION_MAX_ITEMS)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  ids!: string[];

  @ApiProperty({
    description: 'Mandatory reason recorded in one audit entry per item.',
    example: 'Verified supporting documents',
  })
  @IsString()
  @Matches(/\S/, { message: 'reason must not be blank' })
  @MaxLength(500)
  reason!: string;
}
