import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { AdminStatsService } from './services/admin-stats.service';
import {
  ADMIN_STAT_SECTIONS,
  AdminStatsQueryDto,
} from './dto/admin-stats-query.dto';
import { AdminStatsDto } from './dto/admin-stats-response.dto';

@ApiTags('admin')
@ApiBearerAuth('JWT-auth')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminStatsController {
  constructor(private readonly adminStatsService: AdminStatsService) {}

  @Get('stats')
  @ApiOperation({
    summary: 'Get dashboard counts (admin only)',
    description:
      'Returns pending approvals, open disputes, documents awaiting ' +
      'verification and new users in one cached response. Use `include` ' +
      'to request a subset of sections.',
  })
  @ApiOkResponse({ type: AdminStatsDto })
  async getStats(@Query() query: AdminStatsQueryDto) {
    const sections = query.include?.length
      ? query.include
      : ADMIN_STAT_SECTIONS;

    return this.adminStatsService.getStats(sections);
  }
}
