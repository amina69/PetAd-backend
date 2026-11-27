import {
  Controller,
  Get,
  Param,
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
import { ShelterAnalyticsService } from './shelter-analytics.service';
import { ShelterAnalyticsResponseDto } from './dto/shelter-analytics-response.dto';

@ApiTags('shelter-analytics')
@ApiBearerAuth('JWT-auth')
@Controller('shelters')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SHELTER, Role.ADMIN, Role.ANALYST)
export class ShelterAnalyticsController {
  constructor(
    private readonly shelterAnalyticsService: ShelterAnalyticsService,
  ) {}

  /**
   * GET /shelters/:id/analytics
   *
   * Retrieves performance metrics for a specific shelter:
   * - listings, time-to-adoption, approval response time, dispute rate, rating summary
   *
   * Permissions:
   * - A shelter can only view their own metrics (querying another returns 404).
   * - Admins/analysts can view any shelter's metrics and receive a comparison against the platform median.
   *
   * Small-sample suppression:
   * - Stats with fewer than N cases (default 5) are suppressed.
   */
  @Get(':id/analytics')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SHELTER, Role.ADMIN, Role.ANALYST)
  @ApiOperation({
    summary: 'Get shelter performance metrics',
    description:
      'Returns per-shelter performance metrics (listings, time-to-adoption, approval response time, ' +
      'dispute rate, rating summary). Shelters can only view their own metrics (404 otherwise). ' +
      'Admins see all shelters and a platform median comparison. Small samples (< 5 cases) are suppressed.',
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
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing authentication token.',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Insufficient permissions.',
  })
  @ApiResponse({
    status: 404,
    description:
      'Shelter not found or unauthorized shelter cross-query (cannot query another shelter).',
  })
  async getShelterMetrics(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ShelterAnalyticsResponseDto> {
    return this.shelterAnalyticsService.getShelterMetrics(id, user);
  }
}
