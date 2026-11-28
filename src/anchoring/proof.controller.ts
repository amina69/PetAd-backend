import { Controller, Get, Param } from '@nestjs/common';
import { ProofService, EventProofResponse } from './proof.service';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('events')
@Controller('events')
export class ProofController {
  constructor(private readonly proofService: ProofService) {}

  @Get(':id/proof')
  @ApiOperation({ summary: 'Get Merkle inclusion proof for an anchored event' })
  @ApiResponse({ status: 200, description: 'Proof retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Event not found or NOT_YET_ANCHORED' })
  async getProof(@Param('id') id: string): Promise<EventProofResponse> {
    return this.proofService.getProofForEvent(id);
  }
}
