import { Module } from '@nestjs/common';
import { EscrowService } from './escrow.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AdoptionModule } from '../adoption/adoption.module';
import { PetsModule } from '../pets/pets.module';
import { FeesModule } from '../payments/fees/fees.module';
import { PaymentsReportsModule } from '../payments/reports/payments-reports.module';

@Module({
  imports: [
    PrismaModule,
    AdoptionModule,
    PetsModule,
    FeesModule,
    PaymentsReportsModule,
  ],
  providers: [EscrowService],
  exports: [EscrowService],
})
export class EscrowModule {}
