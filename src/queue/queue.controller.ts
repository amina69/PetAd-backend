import {
  Controller,
  Get,
  Post,
  Param,
  ParseUUIDPipe,
  Body,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('Queue Dashboard')
@Controller('queue')
export class QueueController {
  constructor(
    @InjectQueue('events') private readonly eventsQueue: Queue,
    @InjectQueue('notifications') private readonly notificationsQueue: Queue,
  ) {}

  @Get('dashboard')
  @ApiOperation({
    summary: 'Get queue dashboard overview (counts and recent jobs)',
  })
  @ApiResponse({ status: 200, description: 'Dashboard data' })
  async getDashboard() {
    const states = ['active', 'waiting', 'completed', 'failed'] as const;
    const queues = ['events', 'notifications'] as const;
    const data: Record<string, any> = {};

    for (const queueName of queues) {
      const queue =
        queueName === 'events' ? this.eventsQueue : this.notificationsQueue;
      data[queueName] = {};
      for (const state of states) {
        const jobs = await queue.getJobs([state]);
        data[queueName][state] = {
          count: jobs.length,
          jobs: jobs.slice(0, 5), // recent 5
        };
      }
    }

    return {
      timestamp: new Date().toISOString(),
      queues: data,
    };
  }

  @Get(':name/:state')
  @ApiOperation({ summary: 'List jobs in specific state' })
  async getJobs(@Param('name') name: string, @Param('state') state: string) {
    const queue =
      name === 'events' ? this.eventsQueue : this.notificationsQueue;
    const jobs = await queue.getJobs([state as any]);
    return jobs.map((job: Job) => job.toJSON());
  }

  @Get(':name/job/:id')
  @ApiOperation({ summary: 'Inspect single job' })
  async getJob(@Param('name') name: string, @Param('id') id: string) {
    const queue =
      name === 'events' ? this.eventsQueue : this.notificationsQueue;
    const job = await queue.getJob(id);
    return job ? job.toJSON() : null;
  }

  @Post(':name/job/:id/retry')
  @ApiOperation({ summary: 'Retry a failed job' })
  async retryJob(@Param('name') name: string, @Param('id') id: string) {
    const queue =
      name === 'events' ? this.eventsQueue : this.notificationsQueue;
    const job = await queue.getJob(id);
    if (!job) return { error: 'Job not found' };
    await job.retry();
    return { success: true, message: 'Job retried' };
  }

  @Post('add/:name')
  @ApiOperation({ summary: 'Add test job to queue' })
  async addJob(@Param('name') name: string, @Body() data: any) {
    const queue =
      name === 'events' ? this.eventsQueue : this.notificationsQueue;
    const job = await queue.add('test', data);
    return { jobId: job.id };
  }
}
