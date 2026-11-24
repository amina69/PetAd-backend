import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  Matches,
  ValidateNested,
} from 'class-validator';

const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const TX_HASH_PATTERN = /^[a-f0-9]{64}$/i;

export class MerkleProofStepDto {
  @ApiProperty({
    enum: ['left', 'right'],
    description: 'Position of the sibling relative to the current node',
  })
  @IsIn(['left', 'right'])
  position!: 'left' | 'right';

  @ApiProperty({ description: 'Hex-encoded 32-byte sibling hash' })
  @Matches(HASH_PATTERN, { message: 'hash must be a 32-byte hex string' })
  hash!: string;
}

export class VerifyProofDto {
  @ApiProperty({ description: 'Hex-encoded SHA-256 hash of the event' })
  @Matches(HASH_PATTERN, {
    message: 'eventHash must be a 32-byte hex string',
  })
  eventHash!: string;

  @ApiProperty({
    type: [MerkleProofStepDto],
    description: 'Merkle inclusion path, leaf level first',
  })
  @IsArray()
  @ArrayMaxSize(64)
  @ValidateNested({ each: true })
  @Type(() => MerkleProofStepDto)
  proof!: MerkleProofStepDto[];

  @ApiPropertyOptional({
    description: 'Expected Merkle root; looked up from the anchor when omitted',
  })
  @IsOptional()
  @Matches(HASH_PATTERN, {
    message: 'merkleRoot must be a 32-byte hex string',
  })
  merkleRoot?: string;

  @ApiPropertyOptional({
    description:
      'Stellar transaction hash; looked up from the anchor when omitted',
  })
  @IsOptional()
  @Matches(TX_HASH_PATTERN, {
    message: 'txHash must be a 32-byte hex string',
  })
  txHash?: string;
}
