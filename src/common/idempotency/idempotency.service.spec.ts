import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  idempotencyKey: {
    findFirst: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
  },
};

describe('IdempotencyService', () => {
  let service: IdempotencyService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<IdempotencyService>(IdempotencyService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('check()', () => {
    it('returns null when key has never been used', async () => {
      mockPrisma.idempotencyKey.findFirst.mockResolvedValue(null);
      const result = await service.check('k1', 'u1', '/adoptions', 'hash1');
      expect(result).toBeNull();
    });

    it('replays the stored response for the same key+hash', async () => {
      mockPrisma.idempotencyKey.findFirst.mockResolvedValue({
        status: 'COMPLETED',
        requestHash: 'hash1',
        statusCode: 201,
        responseBody: { id: 'adopt-1' },
      });
      const result = await service.check('k1', 'u1', '/adoptions', 'hash1');
      expect(result).toEqual({ statusCode: 201, body: { id: 'adopt-1' } });
    });

    it('throws 409 when key is IN_FLIGHT', async () => {
      mockPrisma.idempotencyKey.findFirst.mockResolvedValue({
        status: 'IN_FLIGHT',
        requestHash: 'hash1',
      });
      await expect(
        service.check('k1', 'u1', '/adoptions', 'hash1'),
      ).rejects.toThrow(ConflictException);
    });

    it('throws 422 when same key is reused with a different body', async () => {
      mockPrisma.idempotencyKey.findFirst.mockResolvedValue({
        status: 'COMPLETED',
        requestHash: 'different-hash',
        statusCode: 201,
        responseBody: {},
      });
      await expect(
        service.check('k1', 'u1', '/adoptions', 'new-hash'),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('reserve()', () => {
    it('creates a key record in IN_FLIGHT state', async () => {
      mockPrisma.idempotencyKey.create.mockResolvedValue({ id: 'ik-1' });
      await service.reserve('k1', 'u1', '/adoptions', 'hash1');
      expect(mockPrisma.idempotencyKey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'IN_FLIGHT' }),
        }),
      );
    });
  });

  describe('complete()', () => {
    it('updates status to COMPLETED with the response', async () => {
      mockPrisma.idempotencyKey.updateMany.mockResolvedValue({ count: 1 });
      await service.complete('k1', 'u1', '/adoptions', 201, { id: 'a1' });
      expect(mockPrisma.idempotencyKey.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'COMPLETED', statusCode: 201 }),
        }),
      );
    });
  });

  describe('hashBody()', () => {
    it('produces the same hash for identical bodies', () => {
      const h1 = service.hashBody({ petId: 'p1', userId: 'u1' });
      const h2 = service.hashBody({ petId: 'p1', userId: 'u1' });
      expect(h1).toBe(h2);
    });

    it('produces different hashes for different bodies', () => {
      const h1 = service.hashBody({ petId: 'p1' });
      const h2 = service.hashBody({ petId: 'p2' });
      expect(h1).not.toBe(h2);
    });
  });
});
