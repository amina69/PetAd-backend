import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AnchoringService } from './anchoring.service';
import { VerifyProofDto } from './dto/verify-proof.dto';

@ApiTags('Verification')
@Controller('verify')
export class VerificationController {
  constructor(private readonly anchoringService: AnchoringService) {}

  /**
   * Public, unauthenticated verification. Event payloads are neither
   * accepted nor returned; the response only describes chain metadata.
   */
  @Post('proof')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Verify an event anchoring proof',
    description:
      'Recomputes the Merkle root from the event hash and proof, then compares ' +
      'it with the root committed on Stellar. No event payload is accepted or returned.',
  })
  @ApiResponse({
    status: 200,
    description: 'Verification result',
    schema: {
      example: {
        valid: true,
        anchoredAt: '2026-11-24T10:00:00.000Z',
        txHash: 'ab12...',
        explorerUrl: 'https://stellar.expert/explorer/testnet/tx/ab12...',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Malformed hash or proof' })
  @ApiResponse({ status: 429, description: 'Rate limited' })
  async verify(@Body() dto: VerifyProofDto) {
    return this.anchoringService.verifyProof(dto);
  }
}
