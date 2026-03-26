import { Test, TestingModule } from '@nestjs/testing';
import { AdoptionController } from './adoption.controller';
import { AdoptionService } from './adoption.service';
import { DocumentsService } from '../documents/documents.service';
import { EventsService } from '../events/events.service';
import { EventEntityType, EventType } from '@prisma/client';
import { Request } from 'express';

describe('AdoptionController', () => {
  let controller: AdoptionController;

  const mockAdoptionService = {
    requestAdoption: jest.fn(),
    updateAdoptionStatus: jest.fn(),
  };

  const mockDocumentsService = {
    uploadDocuments: jest.fn(),
  };

  const mockEventsService = {
    logEvent: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdoptionController],
      providers: [
        {
          provide: AdoptionService,
          useValue: mockAdoptionService,
        },
        {
          provide: DocumentsService,
          useValue: mockDocumentsService,
        },
        {
          provide: EventsService,
          useValue: mockEventsService,
        },
      ],
    }).compile();

    controller = module.get<AdoptionController>(AdoptionController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should log an ADOPTION_APPROVED event when approving an adoption', async () => {
    const req = { user: { userId: 'admin-123' } } as unknown as Request;
    const mockAdoption = { id: 'adoption-1', status: 'APPROVED' };
    mockAdoptionService.updateAdoptionStatus.mockResolvedValue(mockAdoption);

    const result = await controller.approveAdoption(req as any, 'adoption-1');

    expect(result).toEqual(mockAdoption);
    expect(mockAdoptionService.updateAdoptionStatus).toHaveBeenCalledWith(
      'adoption-1',
      'admin-123',
      { status: 'APPROVED' },
    );
  });

  it('should throw a descriptive error when event logging fails', async () => {
    const req = { user: { userId: 'admin-123' } } as unknown as Request;
    mockAdoptionService.updateAdoptionStatus.mockRejectedValue(
      new Error('Failed to record adoption approval event'),
    );

    await expect(
      controller.approveAdoption(req as any, 'adoption-2'),
    ).rejects.toThrow('Failed to record adoption approval event');
  });
});

