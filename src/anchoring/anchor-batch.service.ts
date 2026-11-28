import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AnchorStatus, Prisma } from '@prisma/client';

@Injectable()
export class AnchorBatchService {
  constructor(private readonly prisma: PrismaService) {}

  async createBatch(data: {
    fromPosition: number;
    toPosition: number;
    leafCount: number;
    merkleRoot: string;
    network: string;
    txHash?: string;
    ledger?: bigint;
    status?: AnchorStatus;
  }) {
    try {
      return await this.prisma.anchorBatch.create({ data });
    } catch (error: any) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Overlapping or duplicate batch range for this network');
      }
      throw error;
    }
  }

  async updateBatch(id: string, data: Prisma.AnchorBatchUpdateInput) {
    const batch = await this.prisma.anchorBatch.findUnique({ where: { id } });
    if (batch && batch.status === AnchorStatus.CONFIRMED) {
      throw new BadRequestException('Cannot update a confirmed AnchorBatch');
    }
    return await this.prisma.anchorBatch.update({ where: { id }, data });
  }
}
