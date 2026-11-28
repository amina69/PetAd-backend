import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

export enum CsvResource {
  ADOPTIONS = 'adoptions',
  DOCUMENTS = 'documents',
  PETS = 'pets',
  USERS = 'users',
}

export class CsvExportQueryDto {
  @ApiProperty({ enum: CsvResource, example: CsvResource.ADOPTIONS })
  @IsEnum(CsvResource)
  resource!: CsvResource;
}
