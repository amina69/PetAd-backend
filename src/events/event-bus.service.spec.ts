import { Test, TestingModule } from '@nestjs/testing';
import { EventBusService, PublishEventDto } from './event-bus.service';
import { PrismaService } from '../prisma/prisma.service';

describe('EventBusService', () => {
  let service: EventBusService;
  let prismaMock: any;

  beforeEach(async () => {
    prismaMock = {
      processedEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventBusService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<EventBusService>(EventBusService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should publish events to registered consumers and handle failures without throwing', async () => {
    const failingConsumer = jest.fn().mockRejectedValue(new Error('Network error'));
    const successConsumer = jest.fn().mockResolvedValue(undefined);

    service.registerConsumer('failing', failingConsumer);
    service.registerConsumer('success', successConsumer);

    const dto: PublishEventDto = {
      eventId: 'evt-123',
      aggregateId: 'agg-456',
      globalPosition: 1,
      eventType: 'PET_REGISTERED',
      payload: { name: 'Buddy' },
    };

    await expect(service.publish(dto)).resolves.not.toThrow();
    expect(failingConsumer).toHaveBeenCalledWith(dto);
    expect(successConsumer).toHaveBeenCalledWith(dto);
  });
});
