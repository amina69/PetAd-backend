import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PushService } from './push.service';
import {
  CreatePushSubscriptionDto,
  DeletePushSubscriptionDto,
} from './dto/push-subscription.dto';

interface AuthRequest extends Request {
  user?: { userId?: string; sub?: string };
}

@ApiTags('Notifications')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('notifications/push')
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @Post('subscribe')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a Web Push subscription for this device' })
  @ApiResponse({ status: 201, description: 'Subscription stored' })
  @ApiResponse({ status: 503, description: 'Web push is not configured' })
  async subscribe(
    @Body() dto: CreatePushSubscriptionDto,
    @Req() req: AuthRequest,
  ) {
    return this.pushService.subscribe(
      this.userId(req),
      dto,
      req.headers['user-agent'],
    );
  }

  @Delete('subscribe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a Web Push subscription' })
  async unsubscribe(
    @Body() dto: DeletePushSubscriptionDto,
    @Req() req: AuthRequest,
  ) {
    return this.pushService.unsubscribe(this.userId(req), dto.endpoint);
  }

  private userId(req: AuthRequest): string {
    const userId = req.user?.userId ?? req.user?.sub;
    if (!userId) {
      throw new UnauthorizedException();
    }
    return userId;
  }
}
