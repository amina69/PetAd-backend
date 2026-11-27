import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OutboxService } from './outbox.service';
import { OutboxRelayService } from './outbox-relay.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule, ConfigModule],
  providers: [OutboxService, OutboxRelayService],
  exports: [OutboxService, OutboxRelayService],
})
export class OutboxModule {}
