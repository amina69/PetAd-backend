import { Controller, Post, Get, Patch, Param, Body, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ModerationService } from './moderation.service';
import { CreateReportDto } from './dto/create-report.dto';
import { TriageReportDto } from './dto/triage-report.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ReportStatus } from '@prisma/client';

@ApiTags('Moderation')
@Controller('reports')
@UseGuards(JwtAuthGuard, ThrottlerGuard)
@ApiBearerAuth()
export class ModerationController {
  constructor(private readonly moderationService: ModerationService) {}

  @Post()
  @ApiOperation({ summary: 'Create a moderation report (rate limited, one open per target)' })
  @ApiResponse({ status: 201, description: 'Report successfully created' })
  async createReport(
    @CurrentUser() user: { sub?: string; userId?: string },
    @Body() dto: CreateReportDto,
  ) {
    const userId = user.sub ?? user.userId;
    return this.moderationService.createReport(userId!, dto);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'List moderation reports (Admin only)' })
  async listReports(@Query('status') status?: ReportStatus) {
    return this.moderationService.listReports(status);
  }

  @Patch(':id/triage')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Triage a moderation report (Admin only)' })
  async triageReport(
    @Param('id') id: string,
    @CurrentUser() user: { sub?: string; userId?: string },
    @Body() dto: TriageReportDto,
  ) {
    const adminId = user.sub ?? user.userId;
    return this.moderationService.triageReport(id, adminId!, dto);
  }

  @Patch(':id/unhide')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Reverse content hiding for a report (Admin only, evented)' })
  async unhideContent(
    @Param('id') id: string,
    @CurrentUser() user: { sub?: string; userId?: string },
  ) {
    const adminId = user.sub ?? user.userId;
    return this.moderationService.unhideContent(id, adminId!);
  }
}
