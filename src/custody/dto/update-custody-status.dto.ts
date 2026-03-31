import { IsEnum } from 'class-validator';
import { CustodyStatus } from '@prisma/client';

export class UpdateCustodyStatusDto {
  @IsEnum(CustodyStatus)
  status: CustodyStatus;
}
