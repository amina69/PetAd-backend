import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';

const EXPIRY_INTERVAL_MS = 5 * 60 * 1000; // run every 5 minutes

@Injectable()
export class ApprovalExpiryJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ApprovalExpiryJob.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly approvalsService: ApprovalsService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.run(), EXPIRY_INTERVAL_MS);
    this.logger.log('Approval expiry job started');
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async run(): Promise<void> {
    try {
      const count = await this.approvalsService.expireStale();
      if (count > 0) {
        this.logger.log(`Approval expiry job: expired ${count} request(s)`);
      }
    } catch (err) {
      this.logger.error(
        'Approval expiry job failed',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
