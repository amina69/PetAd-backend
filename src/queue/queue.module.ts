import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QueueController } from './queue.controller';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const redisUrl = configService.get<string>('redis') || 'redis://localhost:6379';
        return {
          connection: { url: redisUrl },
        };
      },
      inject: [ConfigService],
    }),
    BullModule.registerQueue({
      name: 'events',
    }),
    BullModule.registerQueue({
      name: 'notifications',
    }),
  ],
  controllers: [QueueController],
})
export class QueueModule {}


