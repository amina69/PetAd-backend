import { Test, TestingModule } from '@nestjs/testing';
import { ModerationService } from './moderation.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { ReportTargetType, ReportStatus } from '@prisma/client';
import { ConflictException } from '@nestjs/common';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

describe('ModerationService', () => {
  let service: ModerationService;
  let prisma: any;
  let events: any;

  beforeEach(async () => {
    prisma = {
      report: {
        findFirst: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      pet: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(prisma)),
    };
    events = {
      logEvent: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModerationService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventsService, useValue: events },
      ],
    }).compile();

    service = module.get<ModerationService>(ModerationService);
  });

  it('should prevent creating duplicate open reports for the same target by the same reporter', async () => {
    prisma.report.findFirst.mockResolvedValue({ id: 'report-1', status: ReportStatus.OPEN });

    await expect(
      service.createReport('reporter-1', {
        targetType: ReportTargetType.USER,
        targetId: 'user-2',
        reason: 'Harassment',
      }),
    ).rejects.toThrow(ConflictException);

    expect(prisma.report.create).not.toHaveBeenCalled();
  });

  it('should create a report successfully when no open report exists', async () => {
    prisma.report.findFirst.mockResolvedValue(null);
    prisma.report.create.mockResolvedValue({
      id: 'report-new',
      reporterId: 'reporter-1',
      targetType: ReportTargetType.USER,
      targetId: 'user-2',
      reason: 'Spam',
      status: ReportStatus.OPEN,
    });

    const result = await service.createReport('reporter-1', {
      targetType: ReportTargetType.USER,
      targetId: 'user-2',
      reason: 'Spam',
    });

    expect(result).toHaveProperty('id', 'report-new');
    expect(prisma.report.create).toHaveBeenCalled();
  });
});
