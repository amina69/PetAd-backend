import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { EventLedgerService } from './event-ledger.service';
import type { EventLedgerQuery } from './event-ledger.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';

@ApiTags('Event Ledger')
@Controller('admin/event-ledger')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.AUDITOR as Role)
@ApiBearerAuth('JWT-auth')
export class EventLedgerController {
  constructor(private readonly eventLedgerService: EventLedgerService) {}

  @Get()
  @ApiOperation({ summary: 'Query the event ledger with cursor pagination' })
  @ApiQuery({ name: 'aggregateType', required: false })
  @ApiQuery({ name: 'aggregateId', required: false })
  @ApiQuery({ name: 'eventType', required: false })
  @ApiQuery({ name: 'actorId', required: false })
  @ApiQuery({ name: 'from', required: false, description: 'Inclusive ISO date-time' })
  @ApiQuery({ name: 'to', required: false, description: 'Inclusive ISO date-time' })
  @ApiQuery({ name: 'cursor', required: false, description: 'Global position cursor' })
  @ApiQuery({ name: 'limit', required: false, example: 50, maximum: 200 })
  @ApiResponse({ status: 200, description: 'A page of event ledger entries' })
  async queryEvents(@Query() query: EventLedgerQuery) {
    return this.eventLedgerService.getLedgerEvents(query);
  }

  @Get(':aggregateId/events')
  @ApiOperation({ summary: 'Get all events for an aggregate', deprecated: true })
  @ApiParam({ name: 'aggregateId', description: 'Aggregate entity ID' })
  @ApiResponse({ status: 200, description: 'List of events for the aggregate' })
  async getAggregateEvents(@Param('aggregateId') aggregateId: string) {
    return this.eventLedgerService.getLedgerEvents({ aggregateId });
  }

  @Get(':aggregateId/integrity')
  @ApiOperation({ summary: 'Check sequence number integrity for an aggregate' })
  @ApiParam({ name: 'aggregateId', description: 'Aggregate entity ID' })
  @ApiResponse({ status: 200, description: 'Integrity check result' })
  async checkIntegrity(@Param('aggregateId') aggregateId: string) {
    const gaps = await this.eventLedgerService.detectGaps(aggregateId);

    return {
      aggregateId,
      valid: gaps.length === 0,
      gaps,
    };
  }

  @Get('type/:aggregateType')
  @ApiOperation({ summary: 'Get events by aggregate type', deprecated: true })
  @ApiParam({
    name: 'aggregateType',
    description: 'Aggregate type (e.g., PET, ADOPTION)',
  })
  @ApiResponse({
    status: 200,
    description: 'List of events for the aggregate type',
  })
  async getEventsByAggregateType(
    @Param('aggregateType') aggregateType: string,
  ) {
    return this.eventLedgerService.getLedgerEvents({ aggregateType });
  }

  @Get('event-type/:eventType')
  @ApiOperation({ summary: 'Get events by event type', deprecated: true })
  @ApiParam({
    name: 'eventType',
    description: 'Event type (e.g., ADOPTION_APPROVED)',
  })
  @ApiResponse({ status: 200, description: 'List of events matching the type' })
  async getEventsByEventType(@Param('eventType') eventType: string) {
    return this.eventLedgerService.getLedgerEvents({ eventType });
  }
}
