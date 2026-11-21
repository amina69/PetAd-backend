import { Module } from '@nestjs/common';
import { FlagsService } from './flags.service';
import { FlagsController } from './flags.controller';
import { AdminFlagsController } from './admin-flags.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { LoggingModule } from '../logging/logging.module';

@Module({
  imports: [PrismaModule, LoggingModule],
  controllers: [FlagsController, AdminFlagsController],
  providers: [FlagsService],
  exports: [FlagsService],
})
export class FlagsModule {}
