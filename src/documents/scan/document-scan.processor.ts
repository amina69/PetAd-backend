import { Process, Processor } from '@nestjs/bull';
import { Logger, Inject, Injectable } from '@nestjs/common';
import type { Job } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { SCANNER_TOKEN } from './scanner.interface';
import type { Scanner } from './scanner.interface';
import { EmailService } from '../../email/email.service';
import * as fs from 'fs';
import * as path from 'path';

@Processor('document-scan')
@Injectable()
export class DocumentScanProcessor {
  private readonly logger = new Logger(DocumentScanProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SCANNER_TOKEN) private readonly scanner: Scanner,
    private readonly emailService: EmailService,
  ) {}

  @Process('document-scan')
  async handleScan(job: Job<{ documentId: string; filePath?: string; fileBuffer?: string }>) {
    const { documentId, filePath, fileBuffer } = job.data;
    this.logger.log(`Processing malware scan for document ${documentId}`);

    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: { uploadedBy: true },
    });

    if (!document) {
      this.logger.warn(`Document ${documentId} not found for scanning`);
      return;
    }

    let buffer: Buffer;
    if (filePath && fs.existsSync(filePath)) {
      buffer = fs.readFileSync(filePath);
    } else if (fileBuffer) {
      buffer = Buffer.from(fileBuffer, 'base64');
    } else {
      const defaultPath = path.join(process.cwd(), 'uploads', document.fileName);
      if (fs.existsSync(defaultPath)) {
        buffer = fs.readFileSync(defaultPath);
      } else {
        throw new Error(`File content not found for document ${documentId}`);
      }
    }

    let scanResult;
    try {
      scanResult = await this.scanner.scanBuffer(buffer);
    } catch (error) {
      this.logger.error(`Scanner outage or failure during scan for document ${documentId}: ${error.message}`);
      throw error;
    }

    if (scanResult.isInfected) {
      this.logger.warn(`MALWARE DETECTED in document ${documentId}: ${JSON.stringify(scanResult.viruses)}`);
      await this.prisma.document.update({
        where: { id: documentId },
        data: { scanStatus: 'INFECTED' } as any,
      });

      if (filePath && fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (e) {
          this.logger.error(`Failed to delete infected file at ${filePath}: ${e.message}`);
        }
      }

      if (document.uploadedBy?.email) {
        try {
          await this.emailService.sendTransactionalEmail({
            to: document.uploadedBy.email,
            subject: 'Security Alert: Uploaded Document Infected',
            text: `Hello,\n\nYour uploaded document "${document.fileName}" was scanned and flagged as infected with malware (${(scanResult.viruses || []).join(', ')}).\n\nThe file has been quarantined and deleted.\n\nBest regards,\nPetAd Security Team`,
          });
        } catch (mailError) {
          this.logger.error(`Failed to send infection notification email: ${mailError.message}`);
        }
      }
    } else {
      this.logger.log(`Document ${documentId} scanned clean.`);
      await this.prisma.document.update({
        where: { id: documentId },
        data: { scanStatus: 'CLEAN' } as any,
      });
    }
  }
}
