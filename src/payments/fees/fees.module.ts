import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LoggingModule } from '../../logging/logging.module';
import { FeeScheduleController } from './fee-schedule.controller';
import { FeeScheduleService } from './fee-schedule.service';
import { FeeCalculationService } from './fee-calculation.service';

@Module({
  imports: [PrismaModule, LoggingModule],
  controllers: [FeeScheduleController],
  providers: [FeeScheduleService, FeeCalculationService],
  exports: [FeeScheduleService, FeeCalculationService],
})
export class FeesModule {}
