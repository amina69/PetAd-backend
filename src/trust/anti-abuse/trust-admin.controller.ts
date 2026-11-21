import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { Role } from '../../auth/enums/role.enum';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
import { AntiAbuseService } from './anti-abuse.service';
import { ResolveAbuseSignalDto } from './dto/review.dto';
import { AbuseFlagStatus } from '@prisma/client';

@ApiTags('admin:trust')
@ApiBearerAuth('JWT-auth')
@Controller('admin/trust')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class TrustAdminController {
  constructor(private readonly antiAbuse: AntiAbuseService) {}

  @Get('signals')
  @ApiOperation({ summary: 'List abuse signals queued for moderators' })
  async signals(@Query('status') status?: AbuseFlagStatus) {
    return this.antiAbuse.getSignals(status);
  }

  @Get('reviews/flagged')
  @ApiOperation({
    summary: 'Flagged reviews with the reasons they were down-weighted',
  })
  async flagged(@Query('status') status?: AbuseFlagStatus) {
    return this.antiAbuse.getFlaggedReviews(status);
  }

  @Post('signals/:id/resolve')
  async resolve(
    @Param('id') id: string,
    @Body() dto: ResolveAbuseSignalDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const admin = user as unknown as { userId?: string; sub?: string } | undefined;
    const adminId = admin?.userId ?? admin?.sub;
    if (!adminId) {
      throw new UnauthorizedException('Authenticated admin is missing');
    }

    return this.antiAbuse.resolveSignal(
      id,
      dto.resolution as AbuseFlagStatus,
      adminId,
      dto.note,
    );
  }
}
