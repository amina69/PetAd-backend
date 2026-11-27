import { Test, TestingModule } from '@nestjs/testing';
import { ProjectionRunnerService } from './projection-runner.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Projection } from './projection.interface';
import { EventType } from '@prisma/client';

describe('ProjectionRunnerService', () => {
  let service: ProjectionRunnerService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      projectionCheckpoint: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({}),
      },
      eventLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'evt-1',
            eventType: EventType.ADOPTION_REQUESTED,
            payload: { petId: 'pet-1' },
            entityType: 'ADOPTION',
            entityId: 'adpt-1',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        ]),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectionRunnerService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ProjectionRunnerService>(ProjectionRunnerService);
  });

  it('should run projection and update checkpoint', async () => {
    const mockProjection: Projection = {
      name: 'test-projection',
      handles: [EventType.ADOPTION_REQUESTED],
      apply: jest.fn().mockResolvedValue(undefined),
      reset: jest.fn().mockResolvedValue(undefined),
    };

    await service.runProjection(mockProjection);

    expect(mockProjection.apply).toHaveBeenCalledTimes(1);
    expect(prisma.projectionCheckpoint.upsert).toHaveBeenCalled();
  });

  it('should rebuild projection by resetting and running', async () => {
    const mockProjection: Projection = {
      name: 'test-projection',
      handles: [EventType.ADOPTION_REQUESTED],
      apply: jest.fn().mockResolvedValue(undefined),
      reset: jest.fn().mockResolvedValue(undefined),
    };

    await service.rebuildProjection(mockProjection);

    expect(mockProjection.reset).toHaveBeenCalledTimes(1);
    expect(prisma.projectionCheckpoint.deleteMany).toHaveBeenCalled();
    expect(mockProjection.apply).toHaveBeenCalledTimes(1);
  });
});
