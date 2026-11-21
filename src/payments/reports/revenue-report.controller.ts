import {
  Controller,
  Get,
  Header,
  HttpStatus,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { Role } from '../../auth/enums/role.enum';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
import {
  RevenueFormat,
  RevenueGroupBy,
  RevenueReportQueryDto,
} from './dto/revenue-report-query.dto';
import { RevenueReportService } from './revenue-report.service';

@ApiTags('admin:reports')
@ApiBearerAuth('JWT-auth')
@Controller('admin/reports/revenue')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class RevenueReportController {
  constructor(private readonly reports: RevenueReportService) {}

  @Get()
  @ApiOperation({
    summary: 'Revenue totals from the payments ledger (admin only)',
  })
  async revenue(
    @Query() query: RevenueReportQueryDto,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const admin = user as unknown as { userId?: string; sub?: string } | undefined;
    const result = await this.reports.request(
      {
        from: new Date(query.from),
        to: new Date(query.to),
        groupBy: query.groupBy ?? RevenueGroupBy.DAY,
        format: query.format ?? RevenueFormat.JSON,
      },
      admin?.userId ?? admin?.sub,
    );

    if (result.status === 'ACCEPTED') {
      res.status(HttpStatus.ACCEPTED);
      return result;
    }

    if (result.csv !== undefined) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="platform-revenue.csv"',
      );
      return result.csv;
    }

    return result.report;
  }

  @Get('jobs/:id')
  async getJob(@Param('id') id: string) {
    return this.reports.getJob(id);
  }

  @Get('jobs/:id/csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async getJobCsv(@Param('id') id: string): Promise<string> {
    return this.reports.getJobCsv(id);
  }
}
