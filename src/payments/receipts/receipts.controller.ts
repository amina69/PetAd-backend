import { Controller, Get, Param, StreamableFile } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator';
import { ReceiptsService } from './receipts.service';

@ApiTags('payments')
@Controller('payments/receipts')
export class ReceiptsController {
  constructor(private readonly receiptsService: ReceiptsService) {}

  @Get('download/:token')
  @Public()
  @ApiOperation({
    summary: 'Download a receipt PDF using a signed URL',
    description:
      'The token is short-lived and bound to one payment and receipt number. ' +
      'Receipt files are stored privately and are only reachable through this endpoint.',
  })
  @ApiParam({ name: 'token', description: 'Signed receipt download token' })
  @ApiResponse({ status: 200, description: 'Receipt PDF' })
  @ApiResponse({ status: 401, description: 'Invalid receipt link' })
  @ApiResponse({ status: 404, description: 'Receipt not found' })
  @ApiResponse({ status: 410, description: 'Receipt link has expired' })
  @ApiBearerAuth('JWT-auth')
  async download(@Param('token') token: string): Promise<StreamableFile> {
    const { buffer, fileName } = await this.receiptsService.download(token);

    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${fileName}"`,
      length: buffer.length,
    });
  }
}
