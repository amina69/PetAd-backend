import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { defaultAnchoringConfig, AnchoringConfigOptions } from './anchoring.config';

@Injectable()
export class AnchoringSchedulerService {
  private readonly logger = new Logger(AnchoringSchedulerService.name);
  private config: AnchoringConfigOptions;
  private pendingEventsCount = 0;
  private lastAnchorTime = Date.now();

  constructor(private readonly configService: ConfigService) {
    this.config = {
      batchSizeThreshold: this.configService.get<number>('ANCHOR_BATCH_SIZE_THRESHOLD', defaultAnchoringConfig.batchSizeThreshold),
      timeIntervalMinutes: this.configService.get<number>('ANCHOR_TIME_INTERVAL_MINUTES', defaultAnchoringConfig.timeIntervalMinutes),
      maxBatchSize: this.configService.get<number>('ANCHOR_MAX_BATCH_SIZE', defaultAnchoringConfig.maxBatchSize),
      minIntervalMinutes: this.configService.get<number>('ANCHOR_MIN_INTERVAL_MINUTES', defaultAnchoringConfig.minIntervalMinutes),
      balanceFloor: this.configService.get<number>('ANCHOR_BALANCE_FLOOR', defaultAnchoringConfig.balanceFloor),
    };
  }

  public shouldAnchor(currentBalance: number): boolean {
    if (currentBalance < this.config.balanceFloor) {
      this.logger.warn(`[BACKPRESSURE] Platform account balance (${currentBalance}) is below floor (${this.config.balanceFloor}). Pausing anchoring submission and alerting.`);
      return false;
    }

    const now = Date.now();
    const elapsedMinutes = (now - this.lastAnchorTime) / (1000 * 60);

    if (elapsedMinutes < this.config.minIntervalMinutes && this.pendingEventsCount < this.config.maxBatchSize && this.pendingEventsCount < this.config.batchSizeThreshold) {
      return false;
    }

    if (this.pendingEventsCount >= this.config.maxBatchSize) {
      return true;
    }

    if (this.pendingEventsCount >= this.config.batchSizeThreshold) {
      return true;
    }

    if (elapsedMinutes >= this.config.timeIntervalMinutes && this.pendingEventsCount > 0) {
      return true;
    }

    return false;
  }

  public recordEvents(count: number): void {
    this.pendingEventsCount += count;
  }

  public resetBatch(): void {
    this.pendingEventsCount = 0;
    this.lastAnchorTime = Date.now();
  }

  public getConfig(): AnchoringConfigOptions {
    return this.config;
  }

  public updateConfig(newConfig: Partial<AnchoringConfigOptions>): void {
    this.config = { ...this.config, ...newConfig };
  }
}
