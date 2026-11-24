import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReassignApprovalDto {
  @ApiProperty({ description: 'ID of the user to reassign the approval to' })
  @IsString()
  @IsNotEmpty()
  newAssigneeId: string;

  @ApiProperty({ description: 'Reason for reassignment' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}
