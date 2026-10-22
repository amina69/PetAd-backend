import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { SheltersService } from './shelters.service';
import { ApplyShelterDto } from './dto/apply-shelter.dto';
import { RejectShelterDto } from './dto/reject-shelter.dto';

@ApiTags('Shelters')
@Controller('shelters')
export class SheltersController {
  constructor(private readonly sheltersService: SheltersService) {}

  /**
   * POST /shelters/apply
   * Any authenticated user (except admins) applies to become a shelter.
   */
  @Post('apply')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Apply for shelter onboarding',
    description:
      'Creates a pending shelter profile and promotes the applicant to the SHELTER role. Listings stay blocked until an admin verifies the shelter.',
  })
  @ApiResponse({ status: 201, description: 'Application submitted' })
  @ApiResponse({
    status: 409,
    description: 'An application already exists for this user',
  })
  apply(@CurrentUser() user: CurrentUserPayload, @Body() dto: ApplyShelterDto) {
    return this.sheltersService.apply(user.userId ?? user.sub, dto);
  }

  /**
   * PATCH /shelters/:id/verify
   * Admin-only. Approves a shelter application.
   */
  @Patch(':id/verify')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'id', description: 'Shelter profile ID' })
  @ApiOperation({ summary: 'Verify a shelter application (Admin only)' })
  @ApiResponse({ status: 200, description: 'Shelter verified' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin role required' })
  @ApiResponse({ status: 404, description: 'Shelter profile not found' })
  @ApiResponse({
    status: 422,
    description: 'Shelter is already verified',
  })
  verify(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.sheltersService.verify(id, user.userId ?? user.sub);
  }

  /**
   * PATCH /shelters/:id/reject
   * Admin-only. Rejects a shelter application.
   */
  @Patch(':id/reject')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'id', description: 'Shelter profile ID' })
  @ApiOperation({ summary: 'Reject a shelter application (Admin only)' })
  @ApiResponse({ status: 200, description: 'Application rejected' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin role required' })
  @ApiResponse({ status: 404, description: 'Shelter profile not found' })
  reject(@Param('id') id: string, @Body() dto: RejectShelterDto) {
    return this.sheltersService.reject(id, dto);
  }

  /**
   * GET /shelters/:id
   * Public. Shelter profile with the verified badge.
   */
  @Get(':id')
  @ApiParam({ name: 'id', description: 'Shelter profile ID' })
  @ApiOperation({ summary: 'Get a public shelter profile with verified badge' })
  @ApiResponse({ status: 200, description: 'Public shelter profile' })
  @ApiResponse({ status: 404, description: 'Shelter profile not found' })
  getPublicProfile(@Param('id') id: string) {
    return this.sheltersService.getPublicProfile(id);
  }
}
