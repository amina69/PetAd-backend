import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { Throttle } from '@nestjs/throttler';
import { VerifyProofDto } from './dto/trust.dto';
import { TrustProofService } from './trust-proof.service';

@ApiTags('Trust')
@Controller('verify')
export class VerificationController {
  constructor(private readonly proofs: TrustProofService) {}

  @Post('proof')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify a trust proof bundle without revealing payloads',
  })
  @ApiOkResponse({ description: 'Proof verification result' })
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  verify(@Body() dto: VerifyProofDto) {
    return this.proofs.verify(dto);
  }
}
