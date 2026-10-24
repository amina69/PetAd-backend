import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { EventsModule } from '../events/events.module';
import { DataExportModule } from './data-export/data-export.module';

@Module({
  imports: [PrismaModule, CloudinaryModule, EventsModule, DataExportModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService, DataExportModule],
})
export class UsersModule {}
