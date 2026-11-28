import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
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
import { getActorId } from '../../common/utils/actor-id';
import { BulkAction, BulkActionDto, BulkResource } from './dto/bulk-action.dto';
import { BulkActionResponseDto } from './dto/bulk-action-result.dto';
import { CsvExportQueryDto } from './dto/csv-export-query.dto';
import { BulkActionsService } from './services/bulk-actions.service';
import { CsvExportService } from './services/csv-export.service';

@ApiTags('admin')
@ApiBearerAuth('JWT-auth')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminBulkController {
  constructor(
    private readonly bulkActionsService: BulkActionsService,
    private readonly csvExportService: CsvExportService,
  ) {}

  @Post('bulk/:resource/:action')
  @ApiOperation({
    summary: 'Apply an admin action to up to 100 records (admin only)',
    description:
      'Each id succeeds or fails independently. Every id produces one audit ' +
      'entry and a per-item result is returned.',
  })
  @ApiParam({ name: 'resource', enum: BulkResource })
  @ApiParam({ name: 'action', enum: BulkAction })
  @ApiOkResponse({ type: BulkActionResponseDto })
  bulk(
    @Param('resource', new ParseEnumPipe(BulkResource)) resource: BulkResource,
    @Param('action', new ParseEnumPipe(BulkAction)) action: BulkAction,
    @Body() dto: BulkActionDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.bulkActionsService.execute(
      resource,
      action,
      dto,
      getActorId(user),
    );
  }

  @Get('export')
  @ApiOperation({
    summary: 'Stream records as CSV (admin only)',
    description:
      'Rows are streamed from a cursor-paginated query, so exports of ' +
      '100k+ rows do not load the full result set into memory. Spreadsheet ' +
      'formula injection is neutralised in every cell.',
  })
  @ApiProduces('text/csv')
  async export(
    @Query() query: CsvExportQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    await this.csvExportService.stream(query.resource, response);
  }
}
