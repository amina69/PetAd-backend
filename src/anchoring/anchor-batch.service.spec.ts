import { Test, TestingModule } from '@nestjs/testing';
import { AnchorBatchService } from './anchor-batch.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { AnchorStatus, Prisma } from '@prisma/client';

describe('AnchorBatchService', () => {
  let service: AnchorBatchService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      anchorBatch: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnchorBatchService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<AnchorBatchService>(AnchorBatchService);
  });

  it('should reject overlapping batches via unique constraint error', async () => {
    const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '5.0.0',
    });
    prisma.anchorBatch.create.mockRejectedValue(err);

    await expect(
      service.createBatch({
        fromPosition: 1,
        toPosition: 10,
        leafCount: 10,
        merkleRoot: '0xabc',
        network: 'testnet',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('should block updating a confirmed batch', async () => {
    prisma.anchorBatch.findUnique.mockResolvedValue({
      id: 'batch-1',
      status: AnchorStatus.CONFIRMED,
    });

    await expect(
      service.updateBatch('batch-1', { status: AnchorStatus.FAILED }),
    ).rejects.toThrow(BadRequestException);
  });
});
