import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { Role } from '../../auth/enums/role.enum';
import { PredictiveInsightsService } from './predictive-insights.service';
import {
  AdoptionTimePredictionDto,
  BacktestResultDto,
  EstimateAdoptionTimeInputDto,
} from './dto/predictive-insights.dto';

@ApiTags('predictive-insights')
@ApiBearerAuth('JWT-auth')
@Controller('analytics/insights')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PredictiveInsightsController {
  constructor(
    private readonly predictiveInsightsService: PredictiveInsightsService,
  ) {}

  /**
   * GET /analytics/insights/predict/:petId
   *
   * Generates an explainable time-to-adoption estimate and listing-quality evaluation for an existing pet.
   */
  @Get('predict/:petId')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.USER, Role.SHELTER, Role.ADMIN, Role.ANALYST)
  @ApiOperation({
    summary: 'Estimate time-to-adoption for an existing pet',
    description:
      'Predicts estimated days to adoption from historical medians (species, age, region). ' +
      'Returns listing-quality score, recommendations, features used, and confidence indicator. ' +
      'No automated decisions are made regarding users.',
  })
  @ApiParam({
    name: 'petId',
    description: 'Unique ID of the pet listing',
    example: 'pet-uuid',
  })
  @ApiResponse({
    status: 200,
    description: 'Time-to-adoption estimate successfully calculated.',
    type: AdoptionTimePredictionDto,
  })
  @ApiResponse({ status: 404, description: 'Pet not found' })
  async predictForPet(
    @Param('petId') petId: string,
  ): Promise<AdoptionTimePredictionDto> {
    return this.predictiveInsightsService.estimateForPet(petId);
  }

  /**
   * POST /analytics/insights/estimate
   *
   * Estimates time-to-adoption and evaluates listing quality for draft or hypothetical listing inputs.
   */
  @Post('estimate')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.USER, Role.SHELTER, Role.ADMIN, Role.ANALYST)
  @ApiOperation({
    summary: 'Estimate time-to-adoption for draft listing inputs',
    description:
      'Allows owners and shelters to evaluate listing quality and expected time-to-adoption prior to publishing.',
  })
  @ApiResponse({
    status: 200,
    description: 'Draft estimate and listing recommendations generated.',
    type: AdoptionTimePredictionDto,
  })
  async estimateDraft(
    @Body() input: EstimateAdoptionTimeInputDto,
  ): Promise<AdoptionTimePredictionDto> {
    return this.predictiveInsightsService.estimateAdoptionTime(input);
  }

  /**
   * GET /analytics/insights/backtest
   *
   * Runs leave-one-out historical cross-validation and reports error metrics (MAE, MdAE, RMSE).
   */
  @Get('backtest')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN, Role.ANALYST)
  @ApiOperation({
    summary:
      'Run historical backtest on adoption time estimator (admin/analyst)',
    description:
      'Evaluates the estimator against all completed historical adoptions and computes MAE, ' +
      'Median Absolute Error, RMSE, and error distributions.',
  })
  @ApiResponse({
    status: 200,
    description: 'Backtest evaluation results successfully generated.',
    type: BacktestResultDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Requires ADMIN or ANALYST role',
  })
  async runBacktest(): Promise<BacktestResultDto> {
    return this.predictiveInsightsService.backtestEstimator();
  }
}
