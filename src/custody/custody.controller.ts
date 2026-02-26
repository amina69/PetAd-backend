import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { CustodyService } from './custody.service';
import { UpdateCustodyStatusDto } from './dto/update-custody-status.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('custody')
@UseGuards(JwtAuthGuard)
export class CustodyController {
  constructor(private readonly custodyService: CustodyService) {}

  /**
   * Get custody by ID
   */
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.custodyService.findOne(id);
  }

  /**
   * Update custody status
   */
  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() updateStatusDto: UpdateCustodyStatusDto,
    @Request() req,
  ) {
    return this.custodyService.updateStatus(
      id,
      updateStatusDto.status,
      req.user?.userId,
    );
  }

  /**
   * Get allowed transitions for a custody
   */
  @Get(':id/transitions')
  async getAllowedTransitions(@Param('id') id: string) {
    return this.custodyService.getAllowedTransitions(id);
  }
}
