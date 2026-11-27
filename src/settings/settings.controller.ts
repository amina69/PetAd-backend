import { Controller, Get, Param, Patch, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { UpdateSettingDto } from './dto/update-setting.dto';
import { RollbackSettingDto } from './dto/rollback-setting.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Settings')
@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Get all system settings' })
  @ApiResponse({ status: 200, description: 'Returns all settings.' })
  async getAll() {
    return this.settingsService.getAllSettings();
  }

  @Get(':key')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Get a single system setting by key' })
  @ApiResponse({ status: 200, description: 'Returns setting value.' })
  async getOne(@Param('key') key: string) {
    const value = await this.settingsService.getSetting(key);
    return { key, value };
  }

  @Get(':key/versions')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Get version history for a setting' })
  @ApiResponse({ status: 200, description: 'Returns list of versions.' })
  async getVersions(@Param('key') key: string) {
    return this.settingsService.getVersions(key);
  }

  @Patch(':key')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update a system setting with validation and versioning' })
  @ApiResponse({ status: 200, description: 'Setting successfully updated.' })
  async update(
    @Param('key') key: string,
    @Body() dto: UpdateSettingDto,
    @CurrentUser() user: any,
  ) {
    const actor = user?.id || user?.sub || 'admin';
    return this.settingsService.updateSetting(key, dto.value, actor, dto.reason);
  }

  @Patch(':key/rollback')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Rollback a setting to a specific version' })
  @ApiResponse({ status: 200, description: 'Setting successfully rolled back and audited.' })
  async rollback(
    @Param('key') key: string,
    @Body() dto: RollbackSettingDto,
    @CurrentUser() user: any,
  ) {
    const actor = user?.id || user?.sub || 'admin';
    return this.settingsService.rollbackSetting(key, dto.version, actor, dto.reason);
  }
}
