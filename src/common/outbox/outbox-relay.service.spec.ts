import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OutboxRelayService } from './outbox-relay.service';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

const mockPrisma = {
  $queryRaw: jest.fn(),
  $executeRaw: jest.fn(),
};

const mockConfigService = {
  get: jest.fn((key: string) => {
    if (key === 'REDIS_URL') return 'redis://localhost:6379';
    return undefined;
  }),
};

describe('OutboxRelayService', () => {
  let service: OutboxRelayService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OutboxRelayService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<OutboxRelayService>(OutboxRelayService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('relays pending messages and returns count', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      { id: 'msg-1', type: 'ESCROW_RELEASE', payload: { escrowId: 'e1' }, attempts: 0 },
    ]);
    mockPrisma.$executeRaw.mockResolvedValue(1);

    const count = await service.relay();
    expect(count).toBe(1);
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('returns 0 when no pending messages', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);
    const count = await service.relay();
    expect(count).toBe(0);
  });

  it('marks message FAILED after max attempts', async () => {
    const { Queue } = jest.requireMock('bullmq') as any;
    Queue.mockImplementation(() => ({
      add: jest.fn().mockRejectedValue(new Error('redis error')),
      close: jest.fn(),
    }));

    // Re-create service with the failing queue mock
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OutboxRelayService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();
    const failService = module.get<OutboxRelayService>(OutboxRelayService);

    mockPrisma.$queryRaw.mockResolvedValue([
      { id: 'msg-2', type: 'TEST', payload: {}, attempts: 4 },
    ]);
    mockPrisma.$executeRaw.mockResolvedValue(1);

    const count = await failService.relay();
    expect(count).toBe(0);
    // attempts (4) + 1 = 5 >= OUTBOX_MAX_ATTEMPTS → FAILED
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
  });
});
