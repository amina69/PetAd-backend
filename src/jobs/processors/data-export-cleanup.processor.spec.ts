import { Test, TestingModule } from '@nestjs/testing';
import { DataExportCleanupProcessor } from './data-export-cleanup.processor';
import { DataExportService } from '../../users/data-export/data-export.service';

describe('DataExportCleanupProcessor', () => {
  let processor: DataExportCleanupProcessor;

  const mockDataExportService = {
    cleanupExpiredExports: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataExportCleanupProcessor,
        { provide: DataExportService, useValue: mockDataExportService },
      ],
    }).compile();

    processor = module.get<DataExportCleanupProcessor>(
      DataExportCleanupProcessor,
    );
  });

  it('calls cleanupExpiredExports and returns count', async () => {
    mockDataExportService.cleanupExpiredExports.mockResolvedValue(5);

    const count = await processor.process();

    expect(mockDataExportService.cleanupExpiredExports).toHaveBeenCalled();
    expect(count).toBe(5);
  });
});
