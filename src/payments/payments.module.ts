import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EscrowModule } from '../escrow/escrow.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { RefundsController } from './refunds/refunds.controller';
import { RefundsService } from './refunds/refunds.service';
import { SettlementService } from './refunds/settlement.service';

@Module({
  imports: [PrismaModule, EscrowModule, NotificationsModule],
  controllers: [PaymentsController, RefundsController],
  providers: [PaymentsService, RefundsService, SettlementService],
  exports: [PaymentsService, RefundsService, SettlementService],
})
export class PaymentsModule {}
