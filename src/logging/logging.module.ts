
import { Module } from '@nestjs/common';
import { LoggingService } from './logging.service';
import { LoggingInterceptor } from './logging.interceptor';
import { PrismaModule } from '../prisma/prisma.module';


@Module({
  imports: [PrismaModule],
  providers: [LoggingService, LoggingInterceptor],
  exports: [LoggingService, LoggingInterceptor],
})
export class LoggingModule {}