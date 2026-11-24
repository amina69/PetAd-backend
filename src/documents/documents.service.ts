import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { UserRole } from '@prisma/client';
import { UploadService } from './upload.service';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
    private readonly uploadService: UploadService,
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

    // Validate every file by content before storing any of them, so a bad
    // file in a batch cannot leave partially-uploaded documents behind.
    const validatedFiles = await this.uploadService.validateAll(
      files,
      'document',
    );

    const uploadedResults: {
      fileName: string;
      fileUrl: string;
      publicId: string;
      mimeType: string;
      size: number;
    }[] = [];

    for (const file of validatedFiles) {
      const result = await this.cloudinary.uploadDocument(
        file.buffer,
        `adoptions/${adoptionId}`,
        file.storageKey,
      );

      uploadedResults.push({
        // Display metadata only: sanitised and using the detected extension.
        fileName: file.displayName,
        fileUrl: result.secure_url,
        publicId: result.public_id,
        mimeType: file.mimeType,
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
}
