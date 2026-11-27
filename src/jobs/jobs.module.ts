import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { QueueInfrastructureModule } from './queues/queue-infrastructure.module';
import { QueueGroupsModule } from './queues/queue-groups.module';

@Global()
@Module({
  imports: [ConfigModule, QueueInfrastructureModule, QueueGroupsModule],
  exports: [QueueInfrastructureModule, QueueGroupsModule],
})
export class JobsModule {}
