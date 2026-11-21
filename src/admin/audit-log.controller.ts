import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { Role } from '../auth/enums/role.enum';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import {
  AuditLogPageView,
  AuditLogService,
} from './services/audit-log.service';

/**
 * Read-only, unified audit log view over EventLog and AppLog.
 *
 * Sensitive metadata (password hashes, tokens, private keys, card data) is
 * stripped recursively before it leaves the API. Every access to this
 * endpoint is itself written to AppLog.
 */
@ApiTags('admin')
@ApiBearerAuth('JWT-auth')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get('audit-log')
  @Roles(Role.ADMIN, Role.AUDITOR)
  @ApiOperation({
    summary: 'Query the unified audit log (admin / auditor)',
    description:
      'Merges EventLog and AppLog into a single cursor-paginated view filtered ' +
      'by actor, action, entity type and date range. Queries are capped at 100 ' +
      'entries; ranges longer than 90 days require both `from` and `to`.',
  })
  @ApiQuery({ name: 'actorId', required: false })
  @ApiQuery({ name: 'action', required: false })
  @ApiQuery({ name: 'entityType', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiResponse({ status: 200, description: 'Audit log page' })
  @ApiResponse({ status: 400, description: 'Invalid range or cursor' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - ADMIN or AUDITOR role required',
  })
  getAuditLog(
    @CurrentUser() user: CurrentUserPayload,
    @Query() query: AuditLogQueryDto,
    @Req() request: Request,
  ): Promise<AuditLogPageView> {
    return this.auditLogService.query(query, {
      userId: user.userId,
      requestId: request.requestId,
    });
  }
}
