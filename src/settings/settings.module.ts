import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { CachedSettingsProvider } from './cached-settings.provider';
import { PrismaModule } from '../prisma/prisma.module';
import { LoggingModule } from '../logging/logging.module';

@Module({
  imports: [PrismaModule, LoggingModule],
  controllers: [SettingsController],
  providers: [SettingsService, CachedSettingsProvider],
  exports: [SettingsService, CachedSettingsProvider],
})
export class SettingsModule {}
