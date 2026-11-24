import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
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
import { DisputesService } from './disputes.service';
import { AdminListDisputesDto, ListDisputesDto } from './dto/list-disputes.dto';

@ApiTags('Disputes')
@ApiBearerAuth('JWT-auth')
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class DisputesController {
  constructor(private readonly disputesService: DisputesService) {}

  @Get('disputes')
  @ApiOperation({
    summary: 'List disputes',
    description:
      'Role-aware: administrators see all disputes, every other user only ' +
      'sees disputes they raised or are the respondent of. Supports status, ' +
      'reason, entity type, date range, sorting and pagination. `counts` ' +
      'contains one entry per status for the UI tabs.',
  })
  @ApiResponse({
    status: 200,
    description: 'Dispute page with per-status counts',
    schema: {
      example: {
        data: [],
        meta: {
          page: 1,
          limit: 20,
          total: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false,
        },
        counts: {
          OPEN: 0,
          UNDER_REVIEW: 0,
          RESOLVED: 0,
          REJECTED: 0,
        },
      },
    },
  })
  async findAll(
    @CurrentUser() user: CurrentUserPayload,
    @Query() query: ListDisputesDto,
  ) {
    return this.disputesService.list(
      { userId: user.userId, role: user.role },
      query,
    );
  }

  @Get('admin/disputes')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'List all disputes with admin filters',
    description:
      'Same as GET /disputes for administrators, plus `assignee` ' +
      '(`me`, `unassigned` or a user UUID) and `minAgeDays`/`maxAgeDays`.',
  })
  @ApiResponse({ status: 200, description: 'Dispute page with counts' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin only' })
  async findAllForAdmin(
    @CurrentUser() user: CurrentUserPayload,
    @Query() query: AdminListDisputesDto,
  ) {
    return this.disputesService.listForAdmin(
      { userId: user.userId, role: user.role },
      query,
    );
  }
}
