import {
  Controller,
  Post,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
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
import { EventReplayService } from './services/event-replay.service';
import { ReplayEventsDto } from './dto/replay-events.dto';
import { EventReplayResponseDto } from './dto/event-replay-response.dto';

@ApiTags('admin')
@ApiBearerAuth('JWT-auth')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminController {
  constructor(private readonly eventReplayService: EventReplayService) {}

  /**
   * POST /admin/replay/:aggregateId
   *
   * Replay the event log for an aggregate. By default runs as a dry
   * run (no DB writes). To apply corrected state, send:
   *   `{ "dryRun": false, "confirm": true }`
   * — the explicit `confirm: true` flag prevents accidental live apply.
   *
   * Admin-only.
   */
  @Post('replay/:aggregateId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Replay an aggregate from its event log (admin only)',
    description:
      'Reconstructs the aggregate state from its event log and ' +
      'compares it against the current DB state. By default runs as a ' +
      'dry run (no DB writes). Pass `dryRun: false` together with ' +
      '`confirm: true` to apply the reconstructed state. Every ' +
      'invocation is audit-logged.',
  })
  @ApiParam({
    name: 'aggregateId',
    description: 'The ID of the aggregate to replay.',
  })
  @ApiResponse({
    status: 200,
    description: 'Replay result (or applied state when dryRun is false).',
    type: EventReplayResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - missing confirm flag',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin role required' })
  @ApiResponse({
    status: 404,
    description: 'No events found for the supplied aggregateId',
  })
  async replayAggregate(
    @Param('aggregateId') aggregateId: string,
    @Body() dto: ReplayEventsDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<EventReplayResponseDto> {
    // JwtStrategy.validate returns { sub, email, role }; the CurrentUser
    // decorator types `userId`. Match the runtime shape by reading either.
    const reqUser = user as unknown as
      | { userId?: string; sub?: string }
      | undefined;
    const actorId = reqUser?.userId ?? reqUser?.sub;

    const dryRun = dto.dryRun ?? true;
    if (!dryRun && dto.confirm !== true) {
      throw new BadRequestException(
        'Live replay requires `confirm: true` alongside `dryRun: false`. ' +
          'This protects against accidental DB mutations.',
      );
    }
    if (!actorId) {
      throw new BadRequestException(
        'Authenticated admin userId (or sub) is missing on the request — cannot audit-log the replay.',
      );
    }

    return this.eventReplayService.replayAggregate({
      aggregateId,
      dryRun,
      upToSequence: dto.upToSequence,
      actorId,
    });
  }
}
// dfghhggh