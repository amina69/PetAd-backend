import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { WebhookService } from './webhook.service';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhookController {
  constructor(private readonly webhooks: WebhookService) {}

  @Post(':provider')
  @HttpCode(HttpStatus.OK)
  @SkipThrottle()
  @ApiOperation({
    summary: 'Receive a signed provider webhook (queued asynchronously)',
  })
  async receive(@Param('provider') provider: string, @Req() req: Request) {
    if (!Buffer.isBuffer(req.rawBody)) {
      throw new BadRequestException('Raw request body is unavailable');
    }

    return this.webhooks.receive(provider, req.rawBody, req.headers);
  }
}
