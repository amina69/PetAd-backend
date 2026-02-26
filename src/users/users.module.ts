import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { TrustScoreService } from './trust-score.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [PrismaModule, CloudinaryModule, EventsModule],
  controllers: [UsersController],
  providers: [UsersService, TrustScoreService],
  exports: [UsersService, TrustScoreService],
})
export class UsersModule {}
