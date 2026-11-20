import { Global, Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { MetricsCollector } from './metrics.collector';

@Global()
@Module({
  providers: [MetricsService, MetricsCollector],
  exports: [MetricsService, MetricsCollector],
})
export class MetricsModule {}
