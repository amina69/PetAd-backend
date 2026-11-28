import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypedQueueService } from './typed-queue.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [TypedQueueService],
  exports: [TypedQueueService],
})
export class QueueInfrastructureModule {}
