import {
  Controller,
  Get,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('admin')
@ApiBearerAuth('JWT-auth')
@Controller('admin/approvals')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminApprovalsController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /admin/approvals
   *
   * Returns a paginated approval queue sourced from EventLog rows with
   * entityType APPROVAL. Supports filtering by type, status, assignee, and age.
   * Each item is enriched with risk flags (new_account) for reviewer context.
   * Non-admins receive 403.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin approval queue with risk flags' })
  @ApiQuery({ name: 'type', required: false, description: 'Filter by request type' })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by approval status' })
  @ApiQuery({ name: 'olderThanDays', required: false, type: Number, description: 'Only items older than N days' })
  @ApiQuery({ name: 'assignee', required: false, description: 'Filter by assignee user ID' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Paginated approval queue' })
  @ApiResponse({ status: 403, description: 'Forbidden: admin only' })
  async listQueue(
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('olderThanDays') olderThanDays?: string,
    @Query('assignee') assignee?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const where: Record<string, unknown> = { entityType: 'APPROVAL' as never };
    if (type) where['eventType'] = type;
    if (status) {
      where['payload'] = { path: ['status'], equals: status };
    }
    if (assignee) where['actorId'] = assignee;
    if (olderThanDays) {
      const days = parseInt(olderThanDays, 10);
      if (!isNaN(days)) {
        where['createdAt'] = { lt: new Date(Date.now() - days * 86_400_000) };
      }
    }

    const [items, total] = await Promise.all([
      this.prisma.eventLog.findMany({
        where: where as never,
        skip,
        take: limitNum,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.eventLog.count({ where: where as never }),
    ]);

    const enriched = await Promise.all(
      items.map(async (item) => {
        const flags: string[] = [];
        if (item.actorId) {
          const user = await this.prisma.user.findUnique({ where: { id: item.actorId } });
          if (user) {
            const accountAgeDays = (Date.now() - user.createdAt.getTime()) / 86_400_000;
            if (accountAgeDays < 30) flags.push('new_account');
          }
        }
        return { ...item, riskFlags: flags };
      }),
    );

    return {
      data: enriched,
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum),
      },
    };
  }

  /**
   * GET /admin/approvals/counts
   *
   * Returns approval event counts for dashboard cards, grouped by event type.
   */
  @Get('counts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approval counts for dashboard cards' })
  @ApiResponse({ status: 200, description: 'Event counts grouped by eventType' })
  async counts() {
    const rows = await this.prisma.eventLog.groupBy({
      by: ['eventType'],
      where: { entityType: 'APPROVAL' as never },
      _count: { id: true },
    });
    return rows.reduce<Record<string, number>>((acc, row) => {
      acc[String(row.eventType)] = row._count.id;
      return acc;
    }, {});
  }
}
