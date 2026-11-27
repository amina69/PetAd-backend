import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsModule } from '../events/events.module';
import { TrustService } from './trust.service';

@Module({
  imports: [PrismaModule, EventsModule],
  providers: [TrustService],
  exports: [TrustService],
})
export class TrustModule {}
