import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
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
import { AdoptionAnalyticsService } from './adoption-analytics.service';
import { DailyAggregatesProjectionService } from './projections/daily-aggregates.projection';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { AdoptionFunnelDto } from './dto/adoption-funnel.dto';
import { ProjectionStateDto } from './dto/projection-state.dto';

@ApiTags('Analytics')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SHELTER)
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly adoptionAnalytics: AdoptionAnalyticsService,
    private readonly projections: DailyAggregatesProjectionService,
  ) {}

  @Get('adoptions/funnel')
  @ApiOperation({
    summary: 'Adoption funnel, conversion, drop-offs and stage medians',
  })
  @ApiResponse({ status: 200, type: AdoptionFunnelDto })
  getAdoptionFunnel(
    @Query() query: AnalyticsQueryDto,
  ): Promise<AdoptionFunnelDto> {
    return this.adoptionAnalytics.getFunnel(query);
  }

  @Get('projections')
  @ApiOperation({ summary: 'Daily aggregate refresh state and lag' })
  @ApiResponse({ status: 200, type: ProjectionStateDto })
  getProjectionState(): Promise<ProjectionStateDto> {
    return this.projections.getState();
  }

  @Post('projections/rebuild')
  @ApiOperation({ summary: 'Rebuild all daily aggregates from the event ledger' })
  @ApiResponse({ status: 201, type: ProjectionStateDto })
  rebuildProjections(): Promise<ProjectionStateDto> {
    return this.projections.rebuildAll();
  }
}
