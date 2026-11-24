import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';

@ApiTags('Notifications')
@ApiBearerAuth('JWT-auth')
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly preferencesService: NotificationPreferencesService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List notifications',
    description:
      "Cursor-paginated list of the caller's notifications, newest first. " +
      'Pass `nextCursor` from the previous response as `cursor` to fetch the ' +
      'next page. Supports `unread` and `type` filters.',
  })
  @ApiResponse({ status: 200, description: 'Notification page' })
  @ApiResponse({ status: 400, description: 'Invalid cursor or query' })
  async findAll(
    @CurrentUser() user: CurrentUserPayload,
    @Query() query: ListNotificationsDto,
  ) {
    return this.notificationsService.findAll(user.userId, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Count unread notifications' })
  @ApiResponse({
    status: 200,
    description: 'Unread count',
    schema: { example: { count: 3 } },
  })
  async unreadCount(@CurrentUser() user: CurrentUserPayload) {
    return this.notificationsService.unreadCount(user.userId);
  }

  @Get('preferences')
  @ApiOperation({
    summary: 'Get notification preferences',
    description:
      'Returns the effective preference for every notification type. ' +
      'Marketing types default to off; security types are always on and ' +
      'report `canDisable: false`.',
  })
  async getPreferences(@CurrentUser() user: CurrentUserPayload) {
    return {
      preferences: await this.preferencesService.findAll(user.userId),
    };
  }

  @Put('preferences')
  @ApiOperation({
    summary: 'Update notification preferences',
    description:
      'Upserts the supplied types. Security notification types cannot be ' +
      'disabled and return 422.',
  })
  @ApiResponse({ status: 200, description: 'Effective preferences' })
  @ApiResponse({
    status: 422,
    description: 'Attempt to disable a security notification type',
  })
  async updatePreferences(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: UpdatePreferencesDto,
  ) {
    return {
      preferences: await this.preferencesService.update(
        user.userId,
        dto.preferences,
      ),
    };
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark all notifications read',
    description: "Single bulk update over the caller's unread rows.",
  })
  @ApiResponse({
    status: 200,
    description: 'Number of rows marked read',
    schema: { example: { updated: 4 } },
  })
  async markAllRead(@CurrentUser() user: CurrentUserPayload) {
    return this.notificationsService.markAllRead(user.userId);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark a notification read',
    description:
      'Idempotent. Notifications owned by another user return 404, the same ' +
      'as a notification that does not exist.',
  })
  @ApiParam({ name: 'id', description: 'Notification ID' })
  @ApiResponse({ status: 200, description: 'Notification after marking' })
  @ApiResponse({ status: 404, description: 'Notification not found' })
  async markRead(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.notificationsService.markRead(user.userId, id);
  }
}
