import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentsScanModule } from './scan/documents-scan.module';
import { DocumentScanProcessor } from './scan/document-scan.processor';
import { PrismaModule } from '../prisma/prisma.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [PrismaModule, CloudinaryModule, DocumentsScanModule, EmailModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
