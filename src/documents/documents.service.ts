import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { UserRole, EventEntityType, EventType } from '@prisma/client';
import { EventsService } from '../events/events.service';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
    private readonly eventsService: EventsService,
  ) {}

  async findAll(status?: string) {
    const where: any = {};
    if (status) {
      where.status = status;
    }
    return this.prisma.document.findMany({
      where,
      include: {
        adoption: {
          select: { id: true, petId: true, adopterId: true, ownerId: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

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

  async verifyDocument(documentId: string, adminId: string) {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: { adoption: true },
    });

    if (!doc) {
      throw new NotFoundException('Document not found');
    }

    const updated = await this.prisma.document.update({
      where: { id: documentId },
      data: { status: 'VERIFIED' } as any,
    });

    await this.eventsService.logEvent({
      entityType: 'ADOPTION' as any,
      entityId: doc.adoptionId,
      eventType: 'DOCUMENT_VERIFIED' as any,
      actorId: adminId,
      payload: { documentId, verifiedBy: adminId, action: 'DOCUMENT_VERIFIED' },
    });

    return updated;
  }

  async rejectDocument(documentId: string, adminId: string, reason: string) {
    if (!reason || !reason.trim()) {
      throw new BadRequestException('Rejection reason is required');
    }

    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: { adoption: true },
    });

    if (!doc) {
      throw new NotFoundException('Document not found');
    }

    const updated = await this.prisma.document.update({
      where: { id: documentId },
      data: { status: 'REJECTED', rejectionReason: reason } as any,
    });

    await this.eventsService.logEvent({
      entityType: 'ADOPTION' as any,
      entityId: doc.adoptionId,
      eventType: 'DOCUMENT_REJECTED' as any,
      actorId: adminId,
      payload: { documentId, reason, rejectedBy: adminId, action: 'DOCUMENT_REJECTED' },
    });

    return updated;
  }

  async uploadDocuments(
    adoptionId: string,
    userId: string,
    userRole: UserRole,
    files: Express.Multer.File[],
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('At least one document is required');
    }

    const adoption = await this.prisma.adoption.findUnique({
      where: { id: adoptionId },
      include: { documents: true },
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

    const hasVerified = adoption.documents.some((d: any) => d.status === 'VERIFIED');
    const existingVersion = adoption.documents.length > 0 ? Math.max(...adoption.documents.map((d: any) => d.version || 1)) : 0;
    const newVersion = hasVerified ? existingVersion + 1 : (adoption.documents.length > 0 ? existingVersion : 1);

    const uploadedResults: {
      fileName: string;
      fileUrl: string;
      publicId: string;
      mimeType: string;
      size: number;
    }[] = [];

    for (const file of files) {
      const result = await this.cloudinary.uploadDocument(
        file.buffer,
        `adoptions/${adoptionId}`,
      );

      uploadedResults.push({
        fileName: file.originalname,
        fileUrl: result.secure_url,
        publicId: result.public_id,
        mimeType: file.mimetype,
        size: file.size,
      });
    }

    const createdDocuments = await this.prisma.$transaction(async (tx) => {
      const docs: any[] = [];
      for (const docData of uploadedResults) {
        const newDoc = await tx.document.create({
          data: {
            ...docData,
            uploadedById: userId,
            adoptionId,
            status: 'PENDING',
            version: newVersion,
          } as any,
        });
        docs.push(newDoc);
      }
      return docs;
    });

    return {
      message: 'Documents uploaded successfully',
      documents: createdDocuments,
    };
  }
}
