import { Test, TestingModule } from '@nestjs/testing';
import { AnchorSubmitterService, AnchorBatchStatus } from './anchor-submitter.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

describe('AnchorSubmitterService', () => {
  let service: AnchorSubmitterService;

  const mockPrisma = {
    anchorBatch: {
      findUnique: jest.fn().mockResolvedValue({ id: 'batch-1', status: AnchorBatchStatus.BUILT, rootHash: 'abc123hash' }),
      update: jest.fn().mockImplementation((args) => Promise.resolve({ id: 'batch-1', ...args.data }))
    },
  };

  const mockConfig = {
    get: jest.fn((key: string) => {
      if (key === 'stellar.horizonUrl') return 'https://horizon-testnet.stellar.org';
      if (key === 'stellar.secretKey') return 'SB76VTWQY5267V3757272V7365V27365V27365V27365V27365V27365';
      if (key === 'stellar.network') return 'testnet';
      return null;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnchorSubmitterService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<AnchorSubmitterService>(AnchorSubmitterService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should submit batch successfully', async () => {
    const result = await service.submitBatch('batch-1', 'abc123hash');
    expect(result.status).toEqual(AnchorBatchStatus.CONFIRMED);
    expect(result.txHash).toBeDefined();
  });
});
