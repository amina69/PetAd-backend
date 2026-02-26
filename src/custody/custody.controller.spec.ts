import { Test, TestingModule } from '@nestjs/testing';
import { CustodyController } from './custody.controller';
import { CustodyService } from './custody.service';
import { CustodyStatus } from '@prisma/client';

describe('CustodyController', () => {
  let controller: CustodyController;
  let service: CustodyService;

  const mockCustody = {
    id: 'custody-1',
    status: CustodyStatus.ACTIVE,
    type: 'TEMPORARY',
    depositAmount: 100,
    startDate: new Date(),
    endDate: null,
    petId: 'pet-1',
    holderId: 'user-1',
    escrowId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    holder: {
      id: 'user-1',
      email: 'holder@example.com',
      firstName: 'John',
      lastName: 'Doe',
      trustScore: 50,
    },
    pet: {
      id: 'pet-1',
      name: 'Buddy',
      species: 'DOG',
    },
  };

  const mockCustodyService = {
    findOne: jest.fn(),
    updateStatus: jest.fn(),
    getAllowedTransitions: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CustodyController],
      providers: [
        {
          provide: CustodyService,
          useValue: mockCustodyService,
        },
      ],
    }).compile();

    controller = module.get<CustodyController>(CustodyController);
    service = module.get<CustodyService>(CustodyService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findOne', () => {
    it('should return custody by ID', async () => {
      mockCustodyService.findOne.mockResolvedValue(mockCustody);

      const result = await controller.findOne('custody-1');

      expect(result).toEqual(mockCustody);
      expect(service.findOne).toHaveBeenCalledWith('custody-1');
    });
  });

  describe('updateStatus', () => {
    it('should update custody status', async () => {
      const updatedCustody = {
        ...mockCustody,
        status: CustodyStatus.RETURNED,
      };
      mockCustodyService.updateStatus.mockResolvedValue(updatedCustody);

      const req = { user: { userId: 'actor-1' } };
      const result = await controller.updateStatus(
        'custody-1',
        { status: CustodyStatus.RETURNED },
        req,
      );

      expect(result).toEqual(updatedCustody);
      expect(service.updateStatus).toHaveBeenCalledWith(
        'custody-1',
        CustodyStatus.RETURNED,
        'actor-1',
      );
    });

    it('should handle request without user', async () => {
      const updatedCustody = {
        ...mockCustody,
        status: CustodyStatus.CANCELLED,
      };
      mockCustodyService.updateStatus.mockResolvedValue(updatedCustody);

      const req = {};
      const result = await controller.updateStatus(
        'custody-1',
        { status: CustodyStatus.CANCELLED },
        req,
      );

      expect(result).toEqual(updatedCustody);
      expect(service.updateStatus).toHaveBeenCalledWith(
        'custody-1',
        CustodyStatus.CANCELLED,
        undefined,
      );
    });
  });

  describe('getAllowedTransitions', () => {
    it('should return allowed transitions', async () => {
      const transitions = {
        currentStatus: CustodyStatus.ACTIVE,
        allowedTransitions: [
          CustodyStatus.RETURNED,
          CustodyStatus.CANCELLED,
          CustodyStatus.VIOLATION,
        ],
        isTerminal: false,
      };
      mockCustodyService.getAllowedTransitions.mockResolvedValue(transitions);

      const result = await controller.getAllowedTransitions('custody-1');

      expect(result).toEqual(transitions);
      expect(service.getAllowedTransitions).toHaveBeenCalledWith('custody-1');
    });
  });
});
