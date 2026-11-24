import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MessagingService } from './messaging.service';

interface AuthRequest extends Request {
  user?: {
    userId?: string;
    sub?: string;
  };
}

@ApiTags('Messaging')
@ApiBearerAuth('JWT-auth')
@Controller('users')
@UseGuards(JwtAuthGuard)
export class BlocksController {
  constructor(private readonly messagingService: MessagingService) {}

  @Post(':id/block')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Block a user',
    description:
      'Blocks new messages in either direction. The blocked user is not told.',
  })
  @ApiResponse({ status: 200, description: 'User blocked' })
  @ApiResponse({ status: 400, description: 'Cannot block yourself' })
  @ApiResponse({ status: 404, description: 'User not found' })
  blockUser(@Param('id') id: string, @Req() req: AuthRequest) {
    const actorId = req.user?.userId ?? req.user?.sub;
    if (!actorId) {
      throw new UnauthorizedException();
    }
    return this.messagingService.blockUser(actorId, id);
  }
}
