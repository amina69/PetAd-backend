import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { UserRole } from '@prisma/client';
import * as crypto from 'crypto';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
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
    userRole: UserRole,
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

    const createdDocuments = await this.prisma.$transaction(
      uploadedResults.map((doc) =>
        this.prisma.document.create({
          data: {
            ...doc,
            uploadedById: userId,
            adoptionId,
          },
        }),
      ),
    );

    return {
      message: 'Documents uploaded successfully',
      documents: createdDocuments,
    };
  }

  async purgeExpiredDocuments(): Promise<{ purgedCount: number; tombstonedCount: number }>
  {
    const now = new Date();
    const allDocs = await this.prisma.document.findMany({
      where: {
        fileUrl: { not: '' },
      },
      include: {
        adoption: {
          select: { id: true, status: true, updatedAt: true },
        },
      },
    });

    const docs = allDocs.filter((d: any) => !d.legalHold && !d.deletedAt);

    let purgedCount = 0;
    let tombstonedCount = 0;

    for (const doc of docs) {
      let shouldDelete = false;
      const createdAt = doc.createdAt;
      const ageDays = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);

      const kind = doc.mimeType?.includes('pdf') ? 'agreement' : 'other';

      const adoption = (doc as any).adoption;
      if (adoption) {
        if (adoption.status === 'REJECTED') {
          if (ageDays >= 30) {
            shouldDelete = true;
          }
        } else if (adoption.status === 'COMPLETED' || adoption.status === 'CANCELLED') {
          const adoptionAgeDays = (now.getTime() - adoption.updatedAt.getTime()) / (1000 * 60 * 60 * 24);
          if (adoptionAgeDays >= 90) {
            shouldDelete = true;
          }
        }
      } else {
        if (ageDays >= 30) {
          shouldDelete = true;
        }
      }

      if (shouldDelete) {
        let fileHash = doc.publicId;
        if (!fileHash && doc.fileUrl) {
          fileHash = crypto.createHash('sha256').update(doc.fileUrl).digest('hex');
        }

        await this.prisma.document.update({
          where: { id: doc.id },
          data: {
            fileUrl: '',
            publicId: fileHash,
          },
        });
        purgedCount++;
        tombstonedCount++;
      }
    }

    return { purgedCount, tombstonedCount };
  }
}
