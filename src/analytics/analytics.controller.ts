import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { AnalyticsService } from './analytics.service';
import { ShelterAnalyticsService } from './shelter-analytics.service';
import { GeoAnalyticsService } from './geo-analytics.service';
import { AnalyticsOverviewQueryDto } from './dto/analytics-overview-query.dto';
import { AnalyticsOverviewResponseDto } from './dto/analytics-overview-response.dto';
import { ShelterAnalyticsResponseDto } from './dto/shelter-analytics-response.dto';
import { GeoAnalyticsResponseDto } from './dto/geo-analytics-response.dto';

@ApiTags('admin-analytics')
@ApiBearerAuth('JWT-auth')
@Controller('admin/analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.ANALYST)
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly shelterAnalyticsService: ShelterAnalyticsService,
    private readonly geoAnalyticsService: GeoAnalyticsService,
  ) {}

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

  /**
   * GET /admin/analytics/shelters/:id
   *
   * Admin endpoint to inspect a specific shelter's performance metrics and platform median comparison.
   */
  @Get('shelters/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Get shelter performance metrics with platform comparison (admin/analyst)',
    description:
      'Returns a shelter performance metrics including listings, time-to-adoption, approval response time, ' +
      'dispute rate, rating summary, and platform median comparison. Small samples are suppressed.',
  })
  @ApiParam({
    name: 'id',
    description: 'The shelter user ID',
    example: 'shelter-uuid',
  })
  @ApiResponse({
    status: 200,
    description: 'Shelter analytics metrics successfully retrieved.',
    type: ShelterAnalyticsResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Requires ADMIN or ANALYST role',
  })
  @ApiResponse({ status: 404, description: 'Shelter not found' })
  async getShelterMetricsAdmin(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ShelterAnalyticsResponseDto> {
    return this.shelterAnalyticsService.getShelterMetrics(id, user);
  }

  /**
   * GET /admin/analytics/geo
   *
   * Geographic adoption patterns:
   * - Supply vs demand by region (state/city)
   * - Under-served regions
   * - Adoption distance distribution
   * - Minimum cell size (k-anonymity >= 5) where smaller regions are merged or omitted
   * - No precise coordinates ever exposed (rounded to at most 1 decimal place)
   */
  @Get('geo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Geographic adoption patterns (admin/analyst)',
    description:
      'Aggregates by region for supply vs demand, under-served regions, and adoption distance distribution. ' +
      'Regions with fewer than 5 records are merged or omitted (k-anonymity). Responses contain no precise coordinates.',
  })
  @ApiResponse({
    status: 200,
    description: 'Geographic adoption patterns successfully retrieved.',
    type: GeoAnalyticsResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Requires ADMIN or ANALYST role',
  })
  async getGeoPatterns(
    @Query('minCellSize') minCellSize?: number,
    @Query('state') state?: string,
  ): Promise<GeoAnalyticsResponseDto> {
    const size = minCellSize ? Number(minCellSize) : undefined;
    return this.geoAnalyticsService.getGeoPatterns(size, state);
  }
}
