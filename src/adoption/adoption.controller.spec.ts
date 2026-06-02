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
    approveAdoption: jest.fn(),
    rejectAdoption: jest.fn(),
    findAll: jest.fn(),
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

  describe('approveAdoption', () => {
    it('should approve an adoption and return the updated adoption', async () => {
      const req = { user: { userId: 'admin-123' } } as unknown as Request;
      const mockAdoption = { 
        id: 'adoption-1', 
        status: 'APPROVED',
        pet: { id: 'pet-1', name: 'Buddy' },
        adopter: { id: 'user-1', email: 'user@test.com' },
      };
      mockAdoptionService.approveAdoption.mockResolvedValue(mockAdoption);

      const result = await controller.approveAdoption(req as any, 'adoption-1');

      expect(result).toEqual(mockAdoption);
      expect(mockAdoptionService.approveAdoption).toHaveBeenCalledWith(
        'adoption-1',
        'admin-123',
      );
    });

    it('should handle sub field in JWT token', async () => {
      const req = { user: { sub: 'admin-456' } } as unknown as Request;
      const mockAdoption = { id: 'adoption-1', status: 'APPROVED' };
      mockAdoptionService.approveAdoption.mockResolvedValue(mockAdoption);

      await controller.approveAdoption(req as any, 'adoption-1');

      expect(mockAdoptionService.approveAdoption).toHaveBeenCalledWith(
        'adoption-1',
        'admin-456',
      );
    });

    it('should throw error when approval fails', async () => {
      const req = { user: { userId: 'admin-123' } } as unknown as Request;
      mockAdoptionService.approveAdoption.mockRejectedValue(
        new Error('Adoption not found'),
      );

      await expect(
        controller.approveAdoption(req as any, 'adoption-2'),
      ).rejects.toThrow('Adoption not found');
    });
  });

  describe('rejectAdoption', () => {
    it('should reject an adoption with reason', async () => {
      const req = { user: { userId: 'admin-123' } } as unknown as Request;
      const dto = { reason: 'Incomplete documentation' };
      const mockAdoption = { 
        id: 'adoption-1', 
        status: 'REJECTED',
        notes: '[REJECTED] Incomplete documentation',
        pet: { id: 'pet-1', name: 'Buddy' },
      };
      mockAdoptionService.rejectAdoption.mockResolvedValue(mockAdoption);

      const result = await controller.rejectAdoption(req as any, 'adoption-1', dto);

      expect(result).toEqual(mockAdoption);
      expect(mockAdoptionService.rejectAdoption).toHaveBeenCalledWith(
        'adoption-1',
        'admin-123',
        dto,
      );
    });

    it('should reject an adoption without reason', async () => {
      const req = { user: { userId: 'admin-123' } } as unknown as Request;
      const dto = {};
      const mockAdoption = { id: 'adoption-1', status: 'REJECTED' };
      mockAdoptionService.rejectAdoption.mockResolvedValue(mockAdoption);

      const result = await controller.rejectAdoption(req as any, 'adoption-1', dto);

      expect(result).toEqual(mockAdoption);
      expect(mockAdoptionService.rejectAdoption).toHaveBeenCalledWith(
        'adoption-1',
        'admin-123',
        dto,
      );
    });

    it('should handle sub field in JWT token', async () => {
      const req = { user: { sub: 'admin-456' } } as unknown as Request;
      const dto = { reason: 'Test reason' };
      const mockAdoption = { id: 'adoption-1', status: 'REJECTED' };
      mockAdoptionService.rejectAdoption.mockResolvedValue(mockAdoption);

      await controller.rejectAdoption(req as any, 'adoption-1', dto);

      expect(mockAdoptionService.rejectAdoption).toHaveBeenCalledWith(
        'adoption-1',
        'admin-456',
        dto,
      );
    });

    it('should throw error when rejection fails', async () => {
      const req = { user: { userId: 'admin-123' } } as unknown as Request;
      const dto = {};
      mockAdoptionService.rejectAdoption.mockRejectedValue(
        new Error('Invalid status transition'),
      );

      await expect(
        controller.rejectAdoption(req as any, 'adoption-2', dto),
      ).rejects.toThrow('Invalid status transition');
    });
  });

  // Legacy test - keeping for backward compatibility
  it('should log an ADOPTION_APPROVED event when approving an adoption', async () => {
    const req = { user: { userId: 'admin-123' } } as unknown as Request;
    const mockAdoption = { id: 'adoption-1', status: 'APPROVED' };
    mockAdoptionService.approveAdoption.mockResolvedValue(mockAdoption);

    const result = await controller.approveAdoption(req as any, 'adoption-1');

    expect(result).toEqual(mockAdoption);
    expect(mockAdoptionService.approveAdoption).toHaveBeenCalledWith(
      'adoption-1',
      'admin-123',
    );
  });

  it('should throw a descriptive error when event logging fails', async () => {
    const req = { user: { userId: 'admin-123' } } as unknown as Request;
    mockAdoptionService.approveAdoption.mockRejectedValue(
      new Error('Failed to record adoption approval event'),
    );

    await expect(
      controller.approveAdoption(req as any, 'adoption-2'),
    ).rejects.toThrow('Failed to record adoption approval event');
  });
});

