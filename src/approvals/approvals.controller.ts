import {
  Controller,
  Post,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { ReassignApprovalDto } from './dto/reassign-approval.dto';

@ApiTags('approvals')
@ApiBearerAuth('JWT-auth')
@Controller('approvals')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ApprovalsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: EventsService,
  ) {}

  /**
   * POST /approvals/:id/reassign
   *
   * Reassign an approval to a different delegate. The delegate must have the
   * ADMIN or SHELTER role; reassigning to any other user returns 422.
   * The previous assignee's ID and the reason are recorded in an
   * APPROVAL_REASSIGNED event for audit purposes.
   *
   * Admin-only.
   */
  @Post(':id/reassign')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reassign an approval to a different delegate (admin only)' })
  @ApiParam({ name: 'id', description: 'Approval entity ID' })
  @ApiBody({ type: ReassignApprovalDto })
  @ApiResponse({ status: 200, description: 'Approval reassigned successfully' })
  @ApiResponse({ status: 422, description: 'Delegate not authorised (must be ADMIN or SHELTER)' })
  async reassign(
    @Param('id') id: string,
    @Body() dto: ReassignApprovalDto,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const delegate = await this.prisma.user.findUnique({ where: { id: dto.newAssigneeId } });
    if (!delegate || (delegate.role !== Role.ADMIN && delegate.role !== Role.SHELTER)) {
      throw new UnprocessableEntityException(
        'Delegate must exist and have ADMIN or SHELTER role',
      );
    }

    // Find the most recent approval event to extract the previous assigneeId
    const previousEvent = await this.prisma.eventLog.findFirst({
      where: { entityId: id, entityType: 'APPROVAL' as never },
      orderBy: { createdAt: 'desc' },
    });

    const previousAssigneeId =
      previousEvent && typeof previousEvent.payload === 'object' && previousEvent.payload !== null
        ? ((previousEvent.payload as Record<string, unknown>)['assigneeId'] ?? null)
        : null;

    await this.eventsService.appendEvent({
      aggregateType: 'APPROVAL',
      aggregateId: id,
      eventType: 'APPROVAL_REASSIGNED',
      actorId: actor.userId,
      payload: {
        previousAssigneeId,
        newAssigneeId: dto.newAssigneeId,
        reason: dto.reason,
      },
    });

    return {
      approvalId: id,
      previousAssigneeId,
      newAssigneeId: dto.newAssigneeId,
      reason: dto.reason,
    };
  }
}
