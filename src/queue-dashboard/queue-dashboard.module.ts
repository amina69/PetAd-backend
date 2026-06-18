import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';

/**
 * QueueDashboardModule
 *
 * Registers the Bull Board dashboard adapter.
 * The actual Express router is built and mounted in main.ts so it can be
 * attached before NestJS middleware runs, which is required by bull-board.
 *
 * This module exists to make the dashboard a first-class NestJS citizen and
 * to ensure JobsModule (which owns the queues) is imported in the right scope.
 */
@Module({
  imports: [JobsModule],
})
export class QueueDashboardModule {}
