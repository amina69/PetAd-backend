import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { TrustProjectionService } from './trust-projection.service';

@Injectable()
export class TrustRecomputeScheduler
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(TrustRecomputeScheduler.name);
  private projectionTimer?: ReturnType<typeof setInterval>;
  private nightlyTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly projection: TrustProjectionService) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') return;

    this.projectionTimer = setInterval(() => {
      void this.projection.processPending(100).catch((error) => {
        this.logger.error(
          'Trust projection sweep failed',
          error instanceof Error ? error.stack : String(error),
        );
      });
    }, 5_000);
    this.projectionTimer.unref?.();

    this.scheduleNightlyRecompute();
  }

  onModuleDestroy(): void {
    if (this.projectionTimer) clearInterval(this.projectionTimer);
    if (this.nightlyTimer) clearTimeout(this.nightlyTimer);
  }

  private scheduleNightlyRecompute(): void {
    const now = new Date();
    const next = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        2,
        0,
        0,
        0,
      ),
    );
    if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);

    this.nightlyTimer = setTimeout(() => {
      void this.projection
        .verifyCache()
        .then((summary) => {
          this.logger.log(
            `Nightly trust recompute verified ${summary.scanned} profiles and corrected ${summary.updated}`,
          );
        })
        .catch((error) => {
          this.logger.error(
            'Nightly trust recompute failed',
            error instanceof Error ? error.stack : String(error),
          );
        })
        .finally(() => this.scheduleNightlyRecompute());
    }, next.getTime() - now.getTime());
    this.nightlyTimer.unref?.();
  }
}
