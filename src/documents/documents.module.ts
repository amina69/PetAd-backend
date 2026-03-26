import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';

@Module({
  imports: [PrismaModule, CloudinaryModule],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
