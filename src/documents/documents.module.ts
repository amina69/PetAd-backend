import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { DocumentRetentionJob } from './retention.job';

@Module({
  imports: [PrismaModule, CloudinaryModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentRetentionJob],
  exports: [DocumentsService, DocumentRetentionJob],
})
export class DocumentsModule {}
