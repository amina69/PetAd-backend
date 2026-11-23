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
import { IsString, IsNotEmpty } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';

class ReassignApprovalDto {
  @IsString()
  @IsNotEmpty()
  newAssigneeId: string;

  @IsString()
  @IsNotEmpty()
  reason: string;
}

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
   * Admin-only: reassign an approval to a different user.
   * Returns 422 if the delegate does not have an authorised role.
   */
  @Post(':id/reassign')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reassign an approval to a different delegate' })
  @ApiParam({ name: 'id', description: 'Approval entity ID' })
  @ApiBody({ type: ReassignApprovalDto })
  @ApiResponse({ status: 200, description: 'Approval reassigned' })
  @ApiResponse({ status: 422, description: 'Delegate not authorised' })
  async reassign(
    @Param('id') id: string,
    @Body() dto: ReassignApprovalDto,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    // Verify the new assignee exists and has an allowed role
    const delegate = await this.prisma.user.findUnique({ where: { id: dto.newAssigneeId } });
    if (!delegate || (delegate.role !== Role.ADMIN && delegate.role !== Role.SHELTER)) {
      throw new UnprocessableEntityException(
        'Delegate must exist and have ADMIN or SHELTER role',
      );
    }

    // Find the most recent event to get the previous assignee
    const previous = await this.prisma.eventLog.findFirst({
      where: { entityId: id, entityType: 'APPROVAL' as never },
      orderBy: { createdAt: 'desc' },
    });

    const previousAssigneeId =
      previous != null
        ? ((previous.payload as Record<string, unknown>)?.['assigneeId'] ?? null)
        : null;

    // Append reassignment event
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
