import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { DocumentScanQueueService } from './scan/document-scan.queue.service';
import { UserRole } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
    private readonly scanQueueService: DocumentScanQueueService,
  ) {}

  /**
   * Loads a single document.
   * Resource-level authorization is enforced by PoliciesGuard before this runs.
   *
   * @throws NotFoundException if the document does not exist
   */
  async findOne(documentId: string) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: {
        adoption: {
          select: { id: true, petId: true, adopterId: true, ownerId: true },
        },
      },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    return document;
  }

  async uploadDocuments(
    adoptionId: string,
    userId: string,
    userRole: string,
    files: Express.Multer.File[],
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('At least one document is required');
    }

    const adoption = await this.prisma.adoption.findUnique({
      where: { id: adoptionId },
    });

    if (!adoption) {
      throw new NotFoundException('Adoption not found');
    }

    const isParticipant =
      adoption.adopterId === userId ||
      adoption.ownerId === userId ||
      userRole === 'ADMIN';

    if (!isParticipant) {
      throw new ForbiddenException(
        'You are not allowed to upload documents for this adoption',
      );
    }

    const createdDocuments: any[] = [];

    for (const file of files) {
      const doc = await this.createDocument({
        fileName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        uploadedById: userId,
        adoptionId,
        fileBuffer: file.buffer,
      });
      createdDocuments.push(doc);
    }

    return {
      message: 'Documents uploaded successfully',
      documents: createdDocuments,
    };
  }

  async createDocument(data: {
    fileName: string;
    mimeType: string;
    size: number;
    uploadedById: string;
    adoptionId?: string;
    fileBuffer?: Buffer;
    filePath?: string;
    fileUrl?: string;
    publicId?: string;
  }) {
    const createData: any = {
      fileName: data.fileName,
      mimeType: data.mimeType,
      size: data.size,
      uploadedBy: { connect: { id: data.uploadedById } },
      scanStatus: 'PENDING',
      fileUrl: data.fileUrl || 'uploads/' + data.fileName,
      publicId: data.publicId || 'doc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
    };
    if (data.adoptionId) {
      createData.adoption = { connect: { id: data.adoptionId } };
    } else {
      createData.adoption = undefined;
    }

    const document = await this.prisma.document.create({
      data: createData,
    });

    let filePath = data.filePath;
    if (!filePath && data.fileBuffer) {
      const uploadDir = path.join(process.cwd(), 'uploads');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      filePath = path.join(uploadDir, `${document.id}-${data.fileName}`);
      fs.writeFileSync(filePath, data.fileBuffer);
    }

    await this.scanQueueService.enqueueScan(
      document.id,
      filePath,
      data.fileBuffer ? data.fileBuffer.toString('base64') : undefined,
    );

    return document;
  }

  async getDocumentForDownload(documentId: string, userId: string, userRole: string) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: { adoption: true },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    if ((document as any).scanStatus !== 'CLEAN') {
      throw new ForbiddenException('Documents can not be downloaded or attached until scanned clean');
    }

    if (
      userRole !== 'ADMIN' &&
      document.uploadedById !== userId &&
      document.adoption?.adopterId !== userId &&
      document.adoption?.ownerId !== userId
    ) {
      throw new ForbiddenException('Access denied to this document');
    }

    return document;
  }
}
