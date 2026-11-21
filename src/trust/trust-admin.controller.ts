import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '../auth/enums/role.enum';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TrustBackfillDto } from './dto/trust.dto';
import { TrustProjectionService } from './trust-projection.service';
import { TrustScoreService } from './trust-score.service';

@ApiTags('Trust administration')
@Controller('admin/trust')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@ApiBearerAuth('JWT-auth')
export class TrustAdminController {
  constructor(
    private readonly projection: TrustProjectionService,
    private readonly scores: TrustScoreService,
  ) {}

  @Post('recompute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify all cached trust scores and repair drift' })
  recompute() {
    return this.projection.verifyCache();
  }

  @Post('replay')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Replay trust events into every score' })
  replay(@Body() dto: TrustBackfillDto) {
    this.assertLiveAllowed(dto);
    return this.projection.replay();
  }

  @Post('backfill')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Backfill scores after an algorithm upgrade' })
  backfill(@Body() dto: TrustBackfillDto) {
    const dryRun = dto.dryRun ?? true;
    this.assertLiveAllowed(dto);
    return this.scores.recomputeAll({
      dryRun,
      force: !dryRun,
      algorithmVersion: dto.algorithmVersion,
    });
  }

  private assertLiveAllowed(dto: TrustBackfillDto): void {
    const dryRun = dto.dryRun ?? true;
    if (!dryRun && dto.confirm !== true) {
      throw new BadRequestException(
        'Live replay requires `confirm: true` alongside `dryRun: false`',
      );
    }
  }
}
