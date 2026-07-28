import { Test, TestingModule } from '@nestjs/testing';
import {
  adoptionReducer,
  EventsService,
  EventLedger,
} from './events.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventEntityType, EventType } from '@prisma/client';

describe('EventsService', () => {
  let service: EventsService;

  const mockPrismaService = {
    eventLog: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
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
        actorId: undefined,
        txHash: undefined,
        blockHeight: undefined,
        payload: mockDto.payload,
        metadata: undefined,
      },
    });
  });

  it('replays three adoption events in sequence order', async () => {
    const events: EventLedger[] = [
      {
        entityType: EventEntityType.ADOPTION,
        entityId: 'adoption-123',
        eventType: 'ADOPTION_REQUESTED',
        sequenceNumber: 1,
        payload: { adopterId: 'user-123', petId: 'pet-123' },
      },
      {
        entityType: EventEntityType.ADOPTION,
        entityId: 'adoption-123',
        eventType: 'ADOPTION_APPROVED',
        sequenceNumber: 2,
        payload: { approvedBy: 'admin-123' },
      },
      {
        entityType: EventEntityType.ADOPTION,
        entityId: 'adoption-123',
        eventType: 'ADOPTION_COMPLETED',
        sequenceNumber: 3,
        payload: { completedAt: '2026-07-28T00:00:00.000Z' },
      },
    ];

    mockPrismaService.eventLog.findMany.mockResolvedValue(events);

    const state = await service.replayAggregate(
      EventEntityType.ADOPTION,
      'adoption-123',
    );

    expect(mockPrismaService.eventLog.findMany).toHaveBeenCalledWith({
      where: {
        entityType: EventEntityType.ADOPTION,
        entityId: 'adoption-123',
      },
      orderBy: {
        sequenceNumber: 'asc',
      },
    });
    expect(state).toEqual({
      adopterId: 'user-123',
      petId: 'pet-123',
      approvedBy: 'admin-123',
      completedAt: '2026-07-28T00:00:00.000Z',
      status: 'COMPLETED',
    });
  });

  it('applies adoption events one at a time through the reducer', () => {
    const initialState = { status: 'NEW' };
    const requested: EventLedger = {
      entityType: EventEntityType.ADOPTION,
      entityId: 'adoption-123',
      eventType: 'ADOPTION_REQUESTED',
      payload: { petId: 'pet-123' },
    };
    const approved: EventLedger = {
      entityType: EventEntityType.ADOPTION,
      entityId: 'adoption-123',
      eventType: 'ADOPTION_APPROVED',
      payload: { approvedBy: 'admin-123' },
    };

    const pending = adoptionReducer(initialState, requested);
    const finalState = adoptionReducer(pending, approved);

    expect(pending).toEqual({ petId: 'pet-123', status: 'PENDING' });
    expect(finalState).toEqual({
      petId: 'pet-123',
      approvedBy: 'admin-123',
      status: 'APPROVED',
    });
  });
});
