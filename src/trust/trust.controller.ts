import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { TrustProfileService, TrustViewer } from './trust-profile.service';

@ApiTags('Trust')
@Controller('users')
@UseGuards(OptionalJwtAuthGuard)
export class TrustController {
  constructor(private readonly profiles: TrustProfileService) {}

  @Get(':id/trust')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get a verifiable trust profile' })
  @ApiOkResponse({ description: 'Trust profile response' })
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  getTrustProfile(
    @Param('id') id: string,
    @Req() request: { user?: TrustViewer },
  ) {
    return this.profiles.getProfile(id, request.user);
  }
}
