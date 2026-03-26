
import { Test, TestingModule } from '@nestjs/testing';
import { LoggingService } from './logging.service';
import { PrismaService } from '../prisma/prisma.service';

describe('LoggingService', () => {
  let service: LoggingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoggingService,
        {
          provide: PrismaService,
          useValue: {
            appLog: {
              create: jest.fn().mockResolvedValue({
                id: '1',
                level: 'INFO',
                action: 'TEST',
                message: 'Test log',
                userId: null,
                metadata: null,
              }),
            },
          },
        },
      ],
    }).compile();

    service = module.get<LoggingService>(LoggingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create a log entry', async () => {
    const result = await service.log({
      level: 'INFO',
      action: 'TEST',
      message: 'Test log',
    });
    expect(result).toBeDefined();
  });

  it('should return null and not throw when db fails', async () => {
    jest.spyOn(service['prisma'].appLog, 'create').mockRejectedValueOnce(
      new Error('DB down'),
    );
    const result = await service.log({
      level: 'ERROR',
      action: 'TEST_FAIL',
      message: 'Should not throw',
    });
    expect(result).toBeNull();
  });
});
