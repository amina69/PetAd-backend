import { Module } from '@nestjs/common';
import { AdoptionController } from './adoption.controller';
import { AdoptionService } from './adoption.service';
import { DocumentsModule } from '../documents/documents.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule, DocumentsModule],
  controllers: [AdoptionController],
  providers: [AdoptionService],
})
export class AdoptionModule {}
