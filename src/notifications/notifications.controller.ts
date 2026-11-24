import {
  Controller,
  Get,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

interface AuthRequest extends Request {
  user?: { userId?: string; sub?: string };
}

@ApiTags('Notifications')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({
    summary: 'List my in-app notifications (priority drives the toast)',
  })
  async list(@Req() req: AuthRequest, @Query('limit') limit?: string) {
    const userId = req.user?.userId ?? req.user?.sub;
    if (!userId) {
      throw new UnauthorizedException();
    }

    const take = Math.min(
      Math.max(Number.parseInt(limit ?? '50', 10) || 50, 1),
      100,
    );

    return this.prisma.notification.findMany({
      where: { userId, channel: 'IN_APP' },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        eventType: true,
        title: true,
        body: true,
        route: true,
        priority: true,
        status: true,
        createdAt: true,
      },
    });
  }
}
