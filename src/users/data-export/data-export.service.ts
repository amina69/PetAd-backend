import {
  Injectable,
  NotFoundException,
  ConflictException,
  GoneException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { PrivateStorageService } from './private-storage.service';
import { createZipArchive, ZipEntry } from './utils/zip.util';
import {
  AssembledUserData,
  SignedUrlResult,
} from './interfaces/data-export.interface';
import { DataExportQueueService } from './data-export-queue.service';
import { DataExportStatus } from '@prisma/client';
import * as crypto from 'crypto';
import * as fs from 'fs';

@Injectable()
export class DataExportService {
  private readonly logger = new Logger(DataExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly privateStorage: PrivateStorageService,
    private readonly configService: ConfigService,
    private readonly queueService: DataExportQueueService,
  ) {}

  async requestDataExport(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true, deletedAt: true },
    });

    if (
      !user ||
      user.status === 'SUSPENDED' ||
      user.status === 'DELETED' ||
      user.deletedAt
    ) {
      throw new NotFoundException('User not found');
    }

    const activeExport = await this.prisma.dataExport.findFirst({
      where: {
        userId,
        status: {
          in: [DataExportStatus.PENDING, DataExportStatus.PROCESSING],
        },
      },
    });

    if (activeExport) {
      throw new ConflictException(
        'An active data export request is already in progress',
      );
    }

    const exportRecord = await this.prisma.dataExport.create({
      data: {
        userId,
        status: DataExportStatus.PENDING,
      },
    });

    await this.queueService.enqueueDataExport({
      exportId: exportRecord.id,
      userId,
    });

    return {
      id: exportRecord.id,
      requestId: exportRecord.id,
      status: exportRecord.status,
      message: 'Data export request enqueued successfully',
    };
  }

  async getDataExportStatus(exportId: string, userId: string) {
    const exportRecord = await this.prisma.dataExport.findUnique({
      where: { id: exportId },
    });

    if (!exportRecord || exportRecord.userId !== userId) {
      throw new NotFoundException('Data export request not found');
    }

    // Auto-expire if past 7-day retention
    if (
      exportRecord.status === DataExportStatus.COMPLETED &&
      exportRecord.expiresAt &&
      exportRecord.expiresAt < new Date()
    ) {
      await this.expireSingleExport(exportRecord.id, exportRecord.filePath);
      return {
        id: exportRecord.id,
        status: DataExportStatus.EXPIRED,
        message: 'The exported file has expired and was purged',
        createdAt: exportRecord.createdAt.toISOString(),
      };
    }

    if (exportRecord.status === DataExportStatus.COMPLETED) {
      const { downloadUrl, expiresAt: linkExpiresAt } = this.generateSignedUrl(
        exportRecord.id,
        userId,
      );

      return {
        id: exportRecord.id,
        status: exportRecord.status,
        downloadUrl,
        linkExpiresAt: linkExpiresAt.toISOString(),
        expiresAt: exportRecord.expiresAt?.toISOString(),
        createdAt: exportRecord.createdAt.toISOString(),
      };
    }

    if (exportRecord.status === DataExportStatus.FAILED) {
      return {
        id: exportRecord.id,
        status: exportRecord.status,
        error: exportRecord.errorMessage || 'Export processing failed',
        createdAt: exportRecord.createdAt.toISOString(),
      };
    }

    if (exportRecord.status === DataExportStatus.EXPIRED) {
      return {
        id: exportRecord.id,
        status: DataExportStatus.EXPIRED,
        message: 'The exported file has expired and was purged',
        createdAt: exportRecord.createdAt.toISOString(),
      };
    }

    return {
      id: exportRecord.id,
      status: exportRecord.status,
      createdAt: exportRecord.createdAt.toISOString(),
    };
  }

  generateSignedUrl(
    exportId: string,
    userId: string,
    ttlSeconds = 900,
  ): SignedUrlResult {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const expiresTimestamp = expiresAt.getTime();
    const secret =
      this.configService.get<string>('JWT_SECRET') || 'default-secret-key';
    const payload = `${exportId}:${userId}:${expiresTimestamp}`;
    const signature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    const downloadUrl = `/users/me/data-export/${exportId}/download?expires=${expiresTimestamp}&sig=${signature}`;
    return { downloadUrl, expiresAt };
  }

  verifySignedUrl(
    exportId: string,
    userId: string,
    expiresTimestamp: number,
    signature: string,
  ): boolean {
    if (!expiresTimestamp || !signature) {
      return false;
    }

    if (Date.now() > expiresTimestamp) {
      return false;
    }

    const secret =
      this.configService.get<string>('JWT_SECRET') || 'default-secret-key';
    const payload = `${exportId}:${userId}:${expiresTimestamp}`;
    const expected = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    if (signature.length !== expected.length) {
      return false;
    }

    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expected, 'hex'),
    );
  }

  async assembleUserData(userId: string): Promise<AssembledUserData> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        trustScore: true,
        stellarPublicKey: true,
        avatarUrl: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    const adoptions = await this.prisma.adoption.findMany({
      where: {
        OR: [{ adopterId: userId }, { ownerId: userId }],
      },
      include: {
        pet: true,
        escrow: true,
        documents: {
          select: {
            id: true,
            fileName: true,
            mimeType: true,
            size: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    const custody = await this.prisma.custody.findMany({
      where: { holderId: userId },
      include: {
        pet: true,
        escrow: true,
      },
    });

    const documents = await this.prisma.document.findMany({
      where: { uploadedById: userId },
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        size: true,
        adoptionId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const events = await this.prisma.eventLog.findMany({
      where: { actorId: userId },
    });

    return {
      exportedAt: new Date().toISOString(),
      userId,
      profile: user,
      adoptions,
      custody,
      documents,
      messages: [],
      events,
    };
  }

  async processDataExport(exportId: string, userId: string): Promise<void> {
    try {
      await this.prisma.dataExport.update({
        where: { id: exportId },
        data: { status: DataExportStatus.PROCESSING },
      });

      const data = await this.assembleUserData(userId);

      const entries: ZipEntry[] = [
        {
          name: 'profile.json',
          content: JSON.stringify(data.profile, null, 2),
        },
        {
          name: 'adoptions.json',
          content: JSON.stringify(data.adoptions, null, 2),
        },
        {
          name: 'custody.json',
          content: JSON.stringify(data.custody, null, 2),
        },
        {
          name: 'documents-metadata.json',
          content: JSON.stringify(data.documents, null, 2),
        },
        {
          name: 'messages.json',
          content: JSON.stringify(data.messages, null, 2),
        },
        { name: 'events.json', content: JSON.stringify(data.events, null, 2) },
        { name: 'data-export.json', content: JSON.stringify(data, null, 2) },
      ];

      const zipBuffer = await createZipArchive(entries);
      const fileName = `export_${userId}_${exportId}.zip`;
      const filePath = await this.privateStorage.saveFile(fileName, zipBuffer);

      // File auto-deleted after 7 days
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await this.prisma.dataExport.update({
        where: { id: exportId },
        data: {
          status: DataExportStatus.COMPLETED,
          filePath,
          fileSize: zipBuffer.length,
          expiresAt,
        },
      });

      this.logger.log(
        `Data export ${exportId} completed successfully for user ${userId}`,
      );
    } catch (error: any) {
      this.logger.error(`Data export ${exportId} failed: ${error.message}`);
      await this.prisma.dataExport
        .update({
          where: { id: exportId },
          data: {
            status: DataExportStatus.FAILED,
            errorMessage: error.message,
          },
        })
        .catch(() => null);
      throw error;
    }
  }

  async getExportFileForDownload(
    exportId: string,
    expires: string | number,
    sig: string,
    authUserId?: string,
  ): Promise<{ stream: fs.ReadStream; fileSize: number; fileName: string }> {
    const exportRecord = await this.prisma.dataExport.findUnique({
      where: { id: exportId },
    });

    if (!exportRecord) {
      throw new NotFoundException('Data export request not found');
    }

    const expiresTimestamp =
      typeof expires === 'string' ? Number.parseInt(expires, 10) : expires;
    const isValidSignature = this.verifySignedUrl(
      exportRecord.id,
      exportRecord.userId,
      expiresTimestamp,
      sig,
    );

    if (!isValidSignature) {
      throw new GoneException(
        'Download link has expired or signature is invalid',
      );
    }

    if (authUserId && authUserId !== exportRecord.userId) {
      throw new NotFoundException('Data export request not found');
    }

    if (exportRecord.status === DataExportStatus.EXPIRED) {
      throw new GoneException('Export file has expired and been purged');
    }

    if (
      exportRecord.status !== DataExportStatus.COMPLETED ||
      !exportRecord.filePath
    ) {
      throw new NotFoundException('Export file is not available');
    }

    const exists = await this.privateStorage.fileExists(exportRecord.filePath);
    if (!exists) {
      throw new NotFoundException('Export file not found or purged');
    }

    const stream = this.privateStorage.createReadStream(exportRecord.filePath);
    return {
      stream,
      fileSize: exportRecord.fileSize || 0,
      fileName: `personal-data-export-${exportId}.zip`,
    };
  }

  private async expireSingleExport(
    exportId: string,
    filePath?: string | null,
  ): Promise<void> {
    if (filePath) {
      await this.privateStorage.deleteFile(filePath);
    }
    await this.prisma.dataExport
      .update({
        where: { id: exportId },
        data: {
          status: DataExportStatus.EXPIRED,
          filePath: null,
        },
      })
      .catch(() => null);
  }

  async cleanupExpiredExports(): Promise<number> {
    const expiredRecords = await this.prisma.dataExport.findMany({
      where: {
        status: DataExportStatus.COMPLETED,
        expiresAt: {
          lte: new Date(),
        },
      },
    });

    let purgedCount = 0;
    for (const record of expiredRecords) {
      await this.expireSingleExport(record.id, record.filePath);
      purgedCount++;
    }

    if (purgedCount > 0) {
      this.logger.log(`Purged ${purgedCount} expired data export files`);
    }
    return purgedCount;
  }
}
