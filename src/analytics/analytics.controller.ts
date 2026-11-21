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
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { AnalyticsService } from './analytics.service';
import { AnalyticsOverviewQueryDto } from './dto/analytics-overview-query.dto';
import { AnalyticsOverviewResponseDto } from './dto/analytics-overview-response.dto';

@ApiTags('admin-analytics')
@ApiBearerAuth('JWT-auth')
@Controller('admin/analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.ANALYST)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * GET /admin/analytics/overview?from&to&granularity
   *
   * Returns aggregated totals and daily time series for platform metrics:
   * - new users, listings, requests, completions, active custody, dispute rate, escrow volume
   *
   * Consistent time zones:
   * - Strictly evaluated and returned in UTC. All bucket dates are UTC YYYY-MM-DD.
   *
   * Acceptance criteria:
   * - Series cover every day in range with zeros for empty days.
   * - Totals equal the sum of the series.
   *
   * Permissions:
   * - Restricted to ADMIN and ANALYST roles.
   *
   * Caching:
   * - Responses are cached per date range and granularity query parameters.
   */
  @Get('overview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Platform metrics overview (admin/analyst)',
    description:
      'Returns platform totals and time series (new users, listings, requests, completions, ' +
      'active custody, dispute rate, escrow volume) evaluated strictly in UTC. ' +
      'Every day in the range is covered with zeros for empty days, and totals equal the ' +
      'sum of the series. Cached for high performance.',
  })
  @ApiResponse({
    status: 200,
    description: 'Analytics overview with totals and daily time series.',
    type: AnalyticsOverviewResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - invalid date range or parameters',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Requires ADMIN or ANALYST role',
  })
  async getOverview(
    @Query() query: AnalyticsOverviewQueryDto,
  ): Promise<AnalyticsOverviewResponseDto> {
    return this.analyticsService.getOverview(query);
  }
}
