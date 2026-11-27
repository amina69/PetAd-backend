import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
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
import { getActorId } from '../common/utils/actor-id';
import { FlagsService } from './flags.service';
import { CreateFeatureFlagDto } from './dto/create-feature-flag.dto';
import { UpdateFeatureFlagDto } from './dto/update-feature-flag.dto';
import { FeatureFlagDto } from './dto/feature-flag-response.dto';

@ApiTags('admin')
@ApiBearerAuth('JWT-auth')
@Controller('admin/flags')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminFlagsController {
  constructor(private readonly flagsService: FlagsService) {}

  @Get()
  @ApiOperation({ summary: 'List all feature flags (admin only)' })
  @ApiOkResponse({ type: FeatureFlagDto, isArray: true })
  findAll() {
    return this.flagsService.findAll();
  }

  @Post()
  @ApiOperation({ summary: 'Create a feature flag (admin only)' })
  @ApiOkResponse({ type: FeatureFlagDto })
  create(
    @Body() dto: CreateFeatureFlagDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.flagsService.create(dto, getActorId(user));
  }

  @Patch(':key')
  @ApiOperation({ summary: 'Update a feature flag (admin only)' })
  @ApiOkResponse({ type: FeatureFlagDto })
  update(
    @Param('key') key: string,
    @Body() dto: UpdateFeatureFlagDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.flagsService.update(key, dto, getActorId(user));
  }

  @Delete(':key')
  @ApiOperation({ summary: 'Delete a feature flag (admin only)' })
  @ApiOkResponse({ type: FeatureFlagDto })
  remove(@Param('key') key: string, @CurrentUser() user: CurrentUserPayload) {
    return this.flagsService.remove(key, getActorId(user));
  }
}
