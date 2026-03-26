import { Controller, Get, Post, Body } from '@nestjs/common';
import {
  HealthCheckService,
  HealthCheck,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaClient } from '@prisma/client';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EventEntityType, EventType } from '@prisma/client';
import { EventsService } from '../events/events.service';

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private db: PrismaHealthIndicator,
    private prisma: PrismaService,
    private eventsService: EventsService,
    @InjectQueue('events') private eventsQueue: Queue,
  ) {}

  @Get()
  @HealthCheck()
  async check() {
    try {
      // Manual check to see if Prisma can actually run a query
      await this.prisma.$queryRaw`SELECT 1`;
      console.log('Manual ping success');
    } catch (e) {
      console.error('Manual ping failed:', e.message);
    }

    return this.health.check([
      () => this.db.pingCheck('database', this.prisma),
    ]);
  }

  @Post('test-job')
  async addTestJob(
    @Body()
    body: {
      entityType: EventEntityType;
      entityId: string;
      eventType: EventType;
      payload?: any;
    },
  ) {
    const jobData = {
      entityType: body.entityType || 'PET',
      entityId: body.entityId || 'test-pet-1',
      eventType: body.eventType || 'PET_LISTED',
      payload: body.payload || { test: true },
    };
    const job = await this.eventsQueue.add('log-event', jobData);
    return { jobId: job.id, message: 'Test job added to events queue' };
  }
}
