import { Test, TestingModule } from '@nestjs/testing';
import { DataExportProcessor } from './data-export.processor';
import { DataExportService } from '../../users/data-export/data-export.service';
import { LoggingService } from '../../logging/logging.service';

describe('DataExportProcessor', () => {
  let processor: DataExportProcessor;

  const mockDataExportService = {
    processDataExport: jest.fn(),
  };

  const mockLoggingService = {
    log: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataExportProcessor,
        { provide: DataExportService, useValue: mockDataExportService },
        { provide: LoggingService, useValue: mockLoggingService },
      ],
    }).compile();

    processor = module.get<DataExportProcessor>(DataExportProcessor);
  });

  it('successfully processes data export job', async () => {
    mockDataExportService.processDataExport.mockResolvedValue(undefined);

    const job: any = {
      id: 'job-1',
      name: 'process_data_export',
      queueName: 'data_export',
      data: {
        exportId: 'export-1',
        userId: 'usr-1',
      },
    };

    await processor.process(job);

    expect(mockDataExportService.processDataExport).toHaveBeenCalledWith(
      'export-1',
      'usr-1',
    );
  });

  it('logs error and throws descriptive error when job fails', async () => {
    mockDataExportService.processDataExport.mockRejectedValue(
      new Error('Disk write error'),
    );
    mockLoggingService.log.mockResolvedValue(null);

    const job: any = {
      id: 'job-2',
      name: 'process_data_export',
      queueName: 'data_export',
      data: {
        exportId: 'export-2',
        userId: 'usr-2',
      },
    };

    await expect(processor.process(job)).rejects.toThrow(
      /Data export job failed.*Disk write error/,
    );
    expect(mockLoggingService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'ERROR',
        action: 'DATA_EXPORT_JOB_FAILED',
        userId: 'usr-2',
      }),
    );
  });
});
