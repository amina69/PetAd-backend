import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateConversationDto {
  @ApiProperty({ description: 'Pet the conversation is about' })
  @IsString()
  @IsNotEmpty()
  petId: string;

  @ApiProperty({ description: 'The other participant in the conversation' })
  @IsString()
  @IsNotEmpty()
  participantId: string;
}
