import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { EventReplayService } from './services/event-replay.service';
import { AdminQueuesService } from './services/admin-queues.service';

describe('AdminController', () => {
  let controller: AdminController;
  let eventReplayService: { replayAggregate: jest.Mock };

  const adminUser = { userId: 'admin-1', email: 'a@b.c', role: 'ADMIN' };

  beforeEach(async () => {
    eventReplayService = { replayAggregate: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: EventReplayService, useValue: eventReplayService },
        { provide: AdminQueuesService, useValue: { getQueue: jest.fn(), claimItem: jest.fn(), unclaimItem: jest.fn() } },
      ],
    }).compile();

    controller = module.get<AdminController>(AdminController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /admin/replay/:aggregateId', () => {
    it('forwards aggregateId, dryRun, upToSequence, and actorId to the service', async () => {
      const expectedResponse = {
        aggregateId: 'a-1',
        aggregateType: 'ADOPTION',
        eventsProcessed: 3,
        replayedState: { status: 'COMPLETED' },
        discrepancies: [],
        appliedToDb: false,
      };
      eventReplayService.replayAggregate.mockResolvedValue(expectedResponse);

      const result = await controller.replayAggregate(
        'a-1',
        { dryRun: true, upToSequence: 3 },
        adminUser,
      );

      expect(eventReplayService.replayAggregate).toHaveBeenCalledWith({
        aggregateId: 'a-1',
        dryRun: true,
        upToSequence: 3,
        actorId: 'admin-1',
      });
      expect(result).toBe(expectedResponse);
    });

    it('defaults to dryRun:true when body omits dryRun', async () => {
      eventReplayService.replayAggregate.mockResolvedValue({} as any);

      await controller.replayAggregate('a-2', {}, adminUser);

      expect(eventReplayService.replayAggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregateId: 'a-2',
          dryRun: true,
        }),
      );
    });

    it('blocks live replay when confirm is not true', async () => {
      await expect(
        controller.replayAggregate(
          'a-3',
          { dryRun: false, confirm: false },
          adminUser,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        controller.replayAggregate('a-3', { dryRun: false }, adminUser),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(eventReplayService.replayAggregate).not.toHaveBeenCalled();
    });

    it('allows live replay when both dryRun:false and confirm:true', async () => {
      eventReplayService.replayAggregate.mockResolvedValue({} as any);

      await controller.replayAggregate(
        'a-4',
        { dryRun: false, confirm: true },
        adminUser,
      );

      expect(eventReplayService.replayAggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregateId: 'a-4',
          dryRun: false,
          actorId: 'admin-1',
        }),
      );
    });

    it('throws when authenticated user has neither userId nor sub', async () => {
      await expect(
        controller.replayAggregate('a-5', { dryRun: true }, {
          email: 'a@b.c',
          role: 'ADMIN',
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(eventReplayService.replayAggregate).not.toHaveBeenCalled();
    });

    it('accepts JWT payloads that carry sub (not userId)', async () => {
      eventReplayService.replayAggregate.mockResolvedValue({} as any);

      await controller.replayAggregate('a-6', { dryRun: true }, {
        sub: 'admin-sub',
        email: 'a@b.c',
        role: 'ADMIN',
      } as any);

      expect(eventReplayService.replayAggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregateId: 'a-6',
          dryRun: true,
          actorId: 'admin-sub',
        }),
      );
    });
  });
});
