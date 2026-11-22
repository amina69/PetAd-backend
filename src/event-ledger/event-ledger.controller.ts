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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import * as crypto from 'crypto';
import { canonicalJSON } from './canonical-json.util';

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
  @ApiOperation({ summary: 'Check sequence number and hash-chain integrity for an aggregate' })
  @ApiParam({ name: 'aggregateId', description: 'Aggregate entity ID' })
  @ApiResponse({ status: 200, description: 'Integrity check result' })
  async checkIntegrity(@Param('aggregateId') aggregateId: string) {
    const gaps = await this.eventLedgerService.detectGaps(aggregateId);
    const events = await this.eventLedgerService.getAggregateEvents(aggregateId);

    let hashValid = true;
    let firstBrokenSequence: number | null = null;
    let expectedPrevHash: string | null = null;

    for (const ev of events) {
      if (ev.sequenceNumber === 1) {
        if (ev.prevHash !== null) {
          hashValid = false;
          firstBrokenSequence = ev.sequenceNumber;
          break;
        }
      } else {
        if (ev.prevHash !== expectedPrevHash) {
          hashValid = false;
          firstBrokenSequence = ev.sequenceNumber;
          break;
        }
      }

      const canonicalObj = {
        aggregate: ev.entityId,
        seq: ev.sequenceNumber,
        type: ev.eventType,
        payload: ev.payload,
        actor: ev.actorId ?? null,
        schemaVersion: 1,
        occurredAt: (ev as any).occurredAt ? new Date((ev as any).occurredAt).toISOString() : new Date(ev.createdAt).toISOString(),
        prevHash: ev.prevHash,
      };

      // Note: if raw SQL modified payload or hash, we recompute and compare against stored eventHash
      const calculatedHash = crypto.createHash('sha256').update(canonicalJSON(canonicalObj)).digest('hex');
      if (calculatedHash !== ev.eventHash) {
        hashValid = false;
        firstBrokenSequence = ev.sequenceNumber;
        break;
      }

      expectedPrevHash = ev.eventHash;
    }

    const valid = gaps.length === 0 && hashValid;

    return {
      aggregateId,
      valid,
      gaps,
      hashValid,
      firstBrokenSequence,
    };
  }

  @Get('type/:aggregateType')
  @ApiOperation({ summary: 'Get events by aggregate type' })
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
    return this.eventLedgerService.getEventsByAggregateType(aggregateType);
  }

  @Get('event-type/:eventType')
  @ApiOperation({ summary: 'Get events by event type' })
  @ApiParam({
    name: 'eventType',
    description: 'Event type (e.g., ADOPTION_APPROVED)',
  })
  @ApiResponse({ status: 200, description: 'List of events matching the type' })
  async getEventsByEventType(@Param('eventType') eventType: string) {
    return this.eventLedgerService.getEventsByEventType(eventType);
  }
}
