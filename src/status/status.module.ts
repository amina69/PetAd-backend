import { Module } from '@nestjs/common';
import { StatusController } from './status.controller';
import { StatusService } from './status.service';
import { AdoptionStatusAdapter } from './adapters/adoption-status.adapter';
import { CustodyStatusAdapter } from './adapters/custody-status.adapter';
import { EscrowStatusAdapter } from './adapters/escrow-status.adapter';
import { StatusHistoryProjection } from './projections/status-history.projection';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [StatusController],
  providers: [
    StatusService,
    AdoptionStatusAdapter,
    CustodyStatusAdapter,
    EscrowStatusAdapter,
    StatusHistoryProjection,
  ],
  exports: [StatusService, StatusHistoryProjection],
})
export class StatusModule {}
