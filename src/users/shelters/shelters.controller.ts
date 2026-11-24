import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { Role } from '../../auth/enums/role.enum';
import { SheltersService } from './shelters.service';
import { ApplyShelterDto } from './dto/apply-shelter.dto';
import { RejectShelterDto } from './dto/reject-shelter.dto';

interface ShelterRequest extends Request {
  user?: { sub?: string; userId?: string; role?: string };
}

@ApiTags('Shelters')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('shelters')
export class SheltersController {
  constructor(private readonly sheltersService: SheltersService) {}

  private userId(req: ShelterRequest): string {
    const id = req.user?.userId ?? req.user?.sub;
    if (!id) {
      throw new UnauthorizedException();
    }
    return id;
  }

  @Post('apply')
  @ApiOperation({
    summary: 'Apply for shelter onboarding',
    description:
      'Creates or re-submits the shelter profile for the authenticated user. ' +
      'The account becomes SHELTER but stays unverified until an admin approves it, ' +
      'so it cannot publish pet listings yet.',
  })
  @ApiBody({ type: ApplyShelterDto })
  @ApiResponse({ status: 201, description: 'Shelter application submitted' })
  @ApiResponse({
    status: 409,
    description: 'Already verified or duplicate registration number',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async apply(@Body() dto: ApplyShelterDto, @Req() req: ShelterRequest) {
    return this.sheltersService.apply(this.userId(req), dto);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get my shelter onboarding profile' })
  @ApiResponse({ status: 200, description: 'Shelter profile retrieved' })
  @ApiResponse({ status: 404, description: 'No shelter application found' })
  async getOwnProfile(@Req() req: ShelterRequest) {
    return this.sheltersService.getOwnProfile(this.userId(req));
  }

  @Patch(':id/verify')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify a shelter application (Admin only)',
    description:
      'Marks the shelter as verified, exposes the verified badge on its public ' +
      'profile and listings, and emits a SHELTER_VERIFIED event plus notification.',
  })
  @ApiParam({ name: 'id', description: 'Shelter profile ID' })
  @ApiResponse({ status: 200, description: 'Shelter verified' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin only' })
  @ApiResponse({ status: 404, description: 'Shelter application not found' })
  @ApiResponse({ status: 409, description: 'Shelter is already verified' })
  async verify(@Param('id') id: string, @Req() req: ShelterRequest) {
    return this.sheltersService.verify(id, req.user?.userId ?? req.user?.sub);
  }

  @Patch(':id/reject')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reject a shelter application (Admin only)',
    description:
      'Rejects the application and keeps the account unverified, so it cannot ' +
      'publish listings. Emits a SHELTER_REJECTED event.',
  })
  @ApiParam({ name: 'id', description: 'Shelter profile ID' })
  @ApiBody({ type: RejectShelterDto })
  @ApiResponse({ status: 200, description: 'Shelter application rejected' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin only' })
  @ApiResponse({ status: 404, description: 'Shelter application not found' })
  async reject(
    @Param('id') id: string,
    @Body() dto: RejectShelterDto,
    @Req() req: ShelterRequest,
  ) {
    return this.sheltersService.reject(
      id,
      dto ?? {},
      req.user?.userId ?? req.user?.sub,
    );
  }
}
