import { IsOptional, IsString } from 'class-validator';

export class RejectAdoptionDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
