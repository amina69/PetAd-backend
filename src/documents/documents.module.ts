import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { UploadService } from './upload.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';

@Module({
  imports: [PrismaModule, CloudinaryModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, UploadService],
  exports: [DocumentsService, UploadService],
})
export class DocumentsModule {}
