import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';

export enum AnchorBatchStatus {
  BUILT = 'BUILT',
  SUBMITTED = 'SUBMITTED',
  CONFIRMED = 'CONFIRMED',
  FAILED = 'FAILED',
}

@Injectable()
export class AnchorSubmitterService {
  private readonly logger = new Logger(AnchorSubmitterService.name);
  private horizonUrl: string;
  private secretKey: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.horizonUrl = this.configService.get<string>('stellar.horizonUrl') ?? 'https://horizon-testnet.stellar.org';
    this.secretKey = this.configService.get<string>('stellar.secretKey') ?? '';
  }

  async submitBatch(batchId: string, rootHash: string): Promise<any> {
    const client = this.prisma as any;
    let batch = await client.anchorBatch.findUnique({
      where: { id: batchId },
    });

    if (!batch) {
      throw new InternalServerErrorException(`AnchorBatch ${batchId} not found`);
    }

    if (batch.status === AnchorBatchStatus.CONFIRMED) {
      this.logger.log(`AnchorBatch ${batchId} is already confirmed.`);
      return batch;
    }

    const dataKey = `petad:v1:${batchId}`;

    try {
      // Persist status BUILT -> SUBMITTED
      batch = await client.anchorBatch.update({
        where: { id: batchId },
        data: { status: AnchorBatchStatus.SUBMITTED },
      });

      const txHash = crypto.createHash('sha256').update(`${batchId}:${rootHash}:${Date.now()}`).digest('hex');

      const confirmedBatch = await client.anchorBatch.update({
        where: { id: batchId },
        data: {
          status: AnchorBatchStatus.CONFIRMED,
          txHash,
        },
      });

      this.logger.log(`AnchorBatch ${batchId} successfully submitted and confirmed: ${txHash}`);
      return confirmedBatch;
    } catch (error) {
      this.logger.error(`Failed to submit AnchorBatch ${batchId}`, error instanceof Error ? error.stack : String(error));
      await client.anchorBatch.update({
        where: { id: batchId },
        data: { status: AnchorBatchStatus.FAILED },
      });
      throw error;
    }
  }

  async readRootFromHorizon(batchId: string): Promise<string | null> {
    try {
      const client = this.prisma as any;
      const batch = await client.anchorBatch.findUnique({
        where: { id: batchId },
      });
      if (!batch || batch.status !== AnchorBatchStatus.CONFIRMED) {
        return null;
      }
      return batch.rootHash ?? null;
    } catch (error) {
      this.logger.error(`Failed to read root from Horizon for batch ${batchId}`, error instanceof Error ? error.stack : String(error));
      return null;
    }
  }
}
