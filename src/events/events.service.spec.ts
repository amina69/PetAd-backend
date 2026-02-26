import { Test, TestingModule } from '@nestjs/testing';
import { EventsService } from './events.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventEntityType, EventType } from '@prisma/client';

describe('EventsService', () => {
  let service: EventsService;

  // 1. Create a strongly typed mock object
  const mockPrismaService = {
    eventLog: {
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    // Clear mocks between tests to prevent state leakage
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<EventsService>(EventsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should call prisma.eventLog.create when logging an event', async () => {
    const mockDto = {
      entityType: EventEntityType.USER,
      entityId: 'user-123',
      eventType: EventType.USER_REGISTERED,
      payload: { test: 'data' },
    };

    mockPrismaService.eventLog.create.mockResolvedValue({
      id: 'log-1',
      ...mockDto,
    });

    await service.logEvent(mockDto);

    expect(mockPrismaService.eventLog.create).toHaveBeenCalledWith({
      data: {
        entityType: mockDto.entityType,
        entityId: mockDto.entityId,
        eventType: mockDto.eventType,
        actorId: undefined, // These will be undefined since they aren't in mockDto
        txHash: undefined,
        blockHeight: undefined,
        payload: mockDto.payload,
        metadata: undefined,
      },
    });
  });
});
