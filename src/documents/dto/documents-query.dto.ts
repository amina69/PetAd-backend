import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { DocumentEntityType } from '@prisma/client';

export class ListDocumentsDto {
  @IsEnum(DocumentEntityType)
  entityType: DocumentEntityType;

  @IsString()
  @IsNotEmpty()
  entityId: string;
}

export class DownloadUrlQueryDto {
  /** Requested lifetime in seconds; clamped to 60-300. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(60)
  @Max(300)
  expiresIn?: number;
}
