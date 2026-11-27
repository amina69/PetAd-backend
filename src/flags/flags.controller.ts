import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { FlagsService } from './flags.service';
import { FeatureFlagsQueryDto } from './dto/feature-flags-query.dto';
import { EvaluatedFlagsDto } from './dto/feature-flag-response.dto';

@ApiTags('flags')
@Controller('flags')
@UseGuards(OptionalJwtAuthGuard)
export class FlagsController {
  constructor(private readonly flagsService: FlagsService) {}

  @Get()
  @ApiOperation({
    summary: 'Get evaluated feature flags for the current caller',
    description:
      'Public endpoint. Signed-in callers receive role- and rollout-aware ' +
      'values; flags evaluate to false for anonymous callers. ' +
      'Unknown requested keys are omitted.',
  })
  @ApiOkResponse({ type: EvaluatedFlagsDto })
  async getFlags(
    @Query() query: FeatureFlagsQueryDto,
    @Req()
    request: Request & {
      user?: { userId?: string; sub?: string; role?: string };
    },
  ): Promise<EvaluatedFlagsDto> {
    const user = request.user as
      | { userId?: string; sub?: string; role?: string }
      | undefined;
    const flags = await this.flagsService.evaluate(
      {
        userId: user?.userId ?? user?.sub,
        role: user?.role,
      },
      query.keys,
    );

    return { flags };
  }
}
