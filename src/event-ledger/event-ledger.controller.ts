import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { EventLedgerService } from './event-ledger.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';

@ApiTags('Event Ledger')
@Controller('admin/event-ledger')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@ApiBearerAuth('JWT-auth')
export class EventLedgerController {
  constructor(private readonly eventLedgerService: EventLedgerService) {}

  @Get(':aggregateId/events')
  @ApiOperation({ summary: 'Get all events for an aggregate' })
  @ApiParam({ name: 'aggregateId', description: 'Aggregate entity ID' })
  @ApiResponse({ status: 200, description: 'List of events for the aggregate' })
  async getAggregateEvents(@Param('aggregateId') aggregateId: string) {
    return this.eventLedgerService.getAggregateEvents(aggregateId);
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
  @ApiOperation({ summary: 'Get events by aggregate type' })
  @ApiParam({ name: 'aggregateType', description: 'Aggregate type (e.g., PET, ADOPTION)' })
  @ApiResponse({ status: 200, description: 'List of events for the aggregate type' })
  async getEventsByAggregateType(@Param('aggregateType') aggregateType: string) {
    return this.eventLedgerService.getEventsByAggregateType(aggregateType);
  }

  @Get('event-type/:eventType')
  @ApiOperation({ summary: 'Get events by event type' })
  @ApiParam({ name: 'eventType', description: 'Event type (e.g., ADOPTION_APPROVED)' })
  @ApiResponse({ status: 200, description: 'List of events matching the type' })
  async getEventsByEventType(@Param('eventType') eventType: string) {
    return this.eventLedgerService.getEventsByEventType(eventType);
  }
}
