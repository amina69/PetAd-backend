import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DocumentEntityType,
  DocumentKind,
  Prisma,
  UserRole,
} from '@prisma/client';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';

const ADMIN_ROLE = 'ADMIN';

const DOCUMENT_METADATA_SELECT = {
  id: true,
  fileName: true,
  mimeType: true,
  size: true,
  kind: true,
  status: true,
  rejectionReason: true,
  sha256: true,
  entityType: true,
  entityId: true,
  adoptionId: true,
  uploadedById: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.DocumentSelect;

const MIN_DOWNLOAD_TTL_SECONDS = 60;
const MAX_DOWNLOAD_TTL_SECONDS = 300;
const DEFAULT_DOWNLOAD_TTL_SECONDS = 120;

export interface DocumentActor {
  userId: string;
  role: string;
}

export interface SignedDownloadUrl {
  url: string;
  expiresAt: string;
  expiresIn: number;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Loads a single (non-deleted) document.
   * Resource-level authorization is enforced by PoliciesGuard before this runs.
   *
   * @throws NotFoundException if the document does not exist or was deleted
   */
  async findOne(documentId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, deletedAt: null },
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

  /**
   * Lists the documents attached to one entity, after checking that the actor
   * may access that entity at all. Non-participants receive 404 so the entity
   * is never disclosed.
   */
  async list(
    entityType: DocumentEntityType,
    entityId: string,
    actor: DocumentActor,
  ) {
    await this.assertEntityAccess(entityType, entityId, actor);

    const where: Prisma.DocumentWhereInput = {
      entityType,
      entityId,
      deletedAt: null,
    };

    // Entity types without a concrete model (health records, other) can only
    // be listed by their uploader unless the caller is an admin.
    if (
      actor.role !== ADMIN_ROLE &&
      (entityType === DocumentEntityType.HEALTH_RECORD ||
        entityType === DocumentEntityType.OTHER)
    ) {
      where.uploadedById = actor.userId;
    }

    return this.prisma.document.findMany({
      where,
      select: DOCUMENT_METADATA_SELECT,
      orderBy: { createdAt: 'desc' },
    });
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
      sha256: string;
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
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
      });
    }

    const createdDocuments = await this.prisma.$transaction(
      uploadedResults.map((doc) =>
        this.prisma.document.create({
          data: {
            ...doc,
            uploadedById: userId,
            adoptionId,
            entityType: DocumentEntityType.ADOPTION,
            entityId: adoptionId,
            kind: DocumentKind.OTHER,
          },
        }),
      ),
    );

    return {
      message: 'Documents uploaded successfully',
      documents: createdDocuments,
    };
  }

  /**
   * Creates a short-lived, app-signed download URL. The URL points at our own
   * `/documents/:id/download` endpoint, which verifies the signature and
   * expiry on every request, so it stops working once `expiresAt` passes.
   */
  async createDownloadUrl(
    documentId: string,
    baseUrl: string,
    requestedTtl?: number,
  ): Promise<SignedDownloadUrl> {
    // Defence in depth: PoliciesGuard has already authorized READ, but the
    // service never signs a URL for a deleted or missing document.
    await this.findOne(documentId);

    const ttl = this.normaliseTtl(requestedTtl);
    const expiresAtSeconds = Math.floor(Date.now() / 1000) + ttl;
    const signature = this.signDownload(documentId, expiresAtSeconds);

    const url = new URL(
      `/api/v1/documents/${encodeURIComponent(documentId)}/download`,
      baseUrl,
    );
    url.searchParams.set('expires', String(expiresAtSeconds));
    url.searchParams.set('sig', signature);

    return {
      url: url.toString(),
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
      expiresIn: ttl,
    };
  }

  /**
   * Verifies a signed download link and returns the document plus its bytes.
   * Expired links are rejected with 410 and can never be reused.
   */
  async downloadSigned(
    documentId: string,
    expires: string | undefined,
    signature: string | undefined,
  ): Promise<{
    document: {
      id: string;
      fileName: string;
      mimeType: string;
      fileUrl: string;
    };
    body: Buffer;
  }> {
    const expiresAtSeconds = Number(expires);

    if (
      !expires ||
      !signature ||
      !Number.isInteger(expiresAtSeconds) ||
      expiresAtSeconds <= 0
    ) {
      throw new ForbiddenException('Invalid download signature');
    }

    if (expiresAtSeconds <= Math.floor(Date.now() / 1000)) {
      throw new GoneException('Download link has expired');
    }

    const expected = this.signDownload(documentId, expiresAtSeconds);
    if (!this.safeEqual(signature, expected)) {
      throw new ForbiddenException('Invalid download signature');
    }

    const document = await this.prisma.document.findFirst({
      where: { id: documentId, deletedAt: null },
      select: { id: true, fileName: true, mimeType: true, fileUrl: true },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    const response = await fetch(document.fileUrl);
    if (!response.ok) {
      throw new NotFoundException('Document file is unavailable');
    }

    const body = Buffer.from(await response.arrayBuffer());

    return { document, body };
  }

  /**
   * Soft-deletes a document. Documents attached to an application that is
   * still being reviewed, or to an open dispute, cannot be removed.
   */
  async remove(documentId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, deletedAt: null },
      select: {
        id: true,
        entityType: true,
        entityId: true,
        adoptionId: true,
      },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    if (document.adoptionId) {
      const adoption = await this.prisma.adoption.findUnique({
        where: { id: document.adoptionId },
        select: { status: true },
      });

      if (
        adoption &&
        ['REQUESTED', 'PENDING', 'APPROVED'].includes(adoption.status)
      ) {
        throw new ConflictException({
          code: 'DOCUMENT_IN_REVIEW',
          message:
            'Document is attached to an adoption that is still under review',
        });
      }
    }

    if (document.entityType === DocumentEntityType.DISPUTE) {
      const dispute = await this.prisma.escrow.findUnique({
        where: { id: document.entityId },
        select: { status: true },
      });

      if (dispute?.status === 'DISPUTED') {
        throw new ConflictException({
          code: 'DOCUMENT_IN_OPEN_DISPUTE',
          message: 'Document is attached to an open dispute',
        });
      }
    }

    const deletedAt = new Date();
    await this.prisma.document.update({
      where: { id: document.id },
      data: { deletedAt },
    });

    return { message: 'Document deleted', id: document.id, deletedAt };
  }

  private normaliseTtl(requested?: number): number {
    if (requested === undefined || requested === null) {
      return DEFAULT_DOWNLOAD_TTL_SECONDS;
    }

    if (!Number.isInteger(requested)) {
      throw new BadRequestException('expiresIn must be an integer');
    }

    return Math.min(
      Math.max(requested, MIN_DOWNLOAD_TTL_SECONDS),
      MAX_DOWNLOAD_TTL_SECONDS,
    );
  }

  private signDownload(documentId: string, expiresAtSeconds: number): string {
    return createHmac('sha256', this.signingSecret())
      .update(`${documentId}:${expiresAtSeconds}`)
      .digest('base64url');
  }

  private signingSecret(): string {
    return (
      this.configService.get<string>('DOCUMENT_SIGNING_SECRET') ||
      this.configService.get<string>('JWT_SECRET') ||
      'document-signing-secret'
    );
  }

  private safeEqual(actual: string, expected: string): boolean {
    const actualBuffer = Buffer.from(actual);
    const expectedBuffer = Buffer.from(expected);

    if (actualBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(actualBuffer, expectedBuffer);
  }

  private async assertEntityAccess(
    entityType: DocumentEntityType,
    entityId: string,
    actor: DocumentActor,
  ) {
    if (actor.role === ADMIN_ROLE) {
      return;
    }

    switch (entityType) {
      case DocumentEntityType.ADOPTION: {
        const adoption = await this.prisma.adoption.findFirst({
          where: {
            id: entityId,
            OR: [{ adopterId: actor.userId }, { ownerId: actor.userId }],
          },
          select: { id: true },
        });
        if (!adoption) throw new NotFoundException('Adoption not found');
        return;
      }

      case DocumentEntityType.CUSTODY: {
        const custody = await this.prisma.custody.findFirst({
          where: {
            id: entityId,
            OR: [
              { holderId: actor.userId },
              { pet: { currentOwnerId: actor.userId } },
            ],
          },
          select: { id: true },
        });
        if (!custody) throw new NotFoundException('Custody not found');
        return;
      }

      case DocumentEntityType.MESSAGE: {
        const message = await this.prisma.message.findFirst({
          where: {
            id: entityId,
            conversation: {
              OR: [
                { participantOneId: actor.userId },
                { participantTwoId: actor.userId },
              ],
            },
          },
          select: { id: true },
        });
        if (!message) throw new NotFoundException('Message not found');
        return;
      }

      case DocumentEntityType.DISPUTE: {
        const dispute = await this.prisma.escrow.findFirst({
          where: {
            id: entityId,
            OR: [
              {
                adoption: {
                  OR: [{ adopterId: actor.userId }, { ownerId: actor.userId }],
                },
              },
              { custody: { holderId: actor.userId } },
            ],
          },
          select: { id: true },
        });
        if (!dispute) throw new NotFoundException('Dispute not found');
        return;
      }

      case DocumentEntityType.PROFILE: {
        if (entityId !== actor.userId) {
          throw new NotFoundException('Profile not found');
        }
        return;
      }

      // HEALTH_RECORD and OTHER have no concrete model yet; the query is
      // restricted to the actor's own uploads above.
      default:
        return;
    }
  }
}
