import { Module } from '@nestjs/common';
import { SheltersController } from './shelters.controller';
import { SheltersService } from './shelters.service';
import { ShelterVerificationGuard } from './shelter-verification.guard';
import { PrismaModule } from '../../prisma/prisma.module';
import { EventsModule } from '../../events/events.module';

@Module({
  imports: [PrismaModule, EventsModule],
  controllers: [SheltersController],
  providers: [SheltersService, ShelterVerificationGuard],
  exports: [SheltersService, ShelterVerificationGuard],
})
export class SheltersModule {}
