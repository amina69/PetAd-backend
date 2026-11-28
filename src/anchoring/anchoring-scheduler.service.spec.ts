import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AnchoringSchedulerService } from './anchoring-scheduler.service';

describe('AnchoringSchedulerService', () => {
  let service: AnchoringSchedulerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnchoringSchedulerService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, defaultValue: any) => defaultValue,
          },
        },
      ],
    }).compile();

    service = module.get<AnchoringSchedulerService>(AnchoringSchedulerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should trigger anchoring when batch size threshold is met', () => {
    service.recordEvents(50);
    expect(service.shouldAnchor(100.0)).toBe(true);
  });

  it('should trigger anchoring when time interval passes and events exist', () => {
    service.recordEvents(5);
    // Mock last anchor time to be in the past exceeding timeIntervalMinutes (15 mins)
    (service as any).lastAnchorTime = Date.now() - 16 * 60 * 1000;
    expect(service.shouldAnchor(100.0)).toBe(true);
  });

  it('should trigger backpressure alert and pause submission on low balance', () => {
    service.recordEvents(100);
    const loggerSpy = jest.spyOn((service as any).logger, 'warn');
    const shouldAnchor = service.shouldAnchor(5.0); // Below balance floor 10.0
    expect(shouldAnchor).toBe(false);
    expect(loggerSpy).toHaveBeenCalled();
  });
});
