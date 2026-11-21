import { Module } from '@nestjs/common';
import { QueueInfrastructureModule } from './queue-infrastructure.module';

@Module({ imports: [QueueInfrastructureModule] })
export class BlockchainConfirmationQueueModule {}

@Module({ imports: [QueueInfrastructureModule] })
export class AnchoringQueueModule {}

@Module({ imports: [QueueInfrastructureModule] })
export class EmailQueueModule {}

@Module({ imports: [QueueInfrastructureModule] })
export class DocumentScanQueueModule {}

@Module({ imports: [QueueInfrastructureModule] })
export class CleanupQueueModule {}

@Module({ imports: [QueueInfrastructureModule] })
export class OutboxQueueModule {}

@Module({
  imports: [
    BlockchainConfirmationQueueModule,
    AnchoringQueueModule,
    EmailQueueModule,
    DocumentScanQueueModule,
    CleanupQueueModule,
    OutboxQueueModule,
  ],
  exports: [
    BlockchainConfirmationQueueModule,
    AnchoringQueueModule,
    EmailQueueModule,
    DocumentScanQueueModule,
    CleanupQueueModule,
    OutboxQueueModule,
  ],
})
export class PlannedQueueGroupsModule {}
