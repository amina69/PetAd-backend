import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LoggingModule } from '../logging/logging.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { FakePaymentProvider } from './provider/fake-payment.provider';
import { PAYMENT_PROVIDER } from './provider/payment-provider.interface';
import { ReceiptsController } from './receipts/receipts.controller';
import { ReceiptsService } from './receipts/receipts.service';
import { ReceiptStorageService } from './receipts/receipt-storage.service';
import { ReceiptSigningService } from './receipts/receipt-signing.service';

@Module({
  imports: [PrismaModule, LoggingModule],
  controllers: [PaymentsController, ReceiptsController],
  providers: [
    PaymentsService,
    ReceiptsService,
    ReceiptStorageService,
    ReceiptSigningService,
    FakePaymentProvider,
    {
      provide: PAYMENT_PROVIDER,
      useExisting: FakePaymentProvider,
    },
  ],
  exports: [PaymentsService, ReceiptsService],
})
export class PaymentsModule {}
