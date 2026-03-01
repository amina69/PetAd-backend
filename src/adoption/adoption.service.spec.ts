import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { AdoptionService } from './adoption.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { EventType, EventEntityType, AdoptionStatus } from '@prisma/client';

const ADOPTER_ID = 'adopter-uuid';
const PET_ID = 'pet-uuid';
const OWNER_ID = 'owner-uuid';
const ADOPTION_ID = 'adoption-uuid';
const ACTOR_ID = 'admin-uuid';

const mockAdoption = {
  id: ADOPTION_ID,
  petId: PET_ID,
  ownerId: OWNER_ID,
  adopterId: ADOPTER_ID,
  status: AdoptionStatus.REQUESTED,
  notes: null,
  escrowId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AdoptionService', () => {
  let service: AdoptionService;

  const mockPrisma = {
    pet: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    adoption: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn().mockImplementation(async (cb) => cb(mockPrisma)),
  };

  const mockEvents = {
    logEvent: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdoptionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventsService, useValue: mockEvents },
      ],
    }).compile();

    service = module.get<AdoptionService>(AdoptionService);
  });

  // ─── requestAdoption ──────────────────────────────────

  describe('requestAdoption', () => {
    const dto = { petId: PET_ID, ownerId: OWNER_ID };

    it('creates the adoption record and fires ADOPTION_REQUESTED', async () => {
      mockPrisma.pet.findUnique.mockResolvedValue({ id: PET_ID, currentOwnerId: OWNER_ID });
      mockPrisma.adoption.findFirst.mockResolvedValue(null);
      mockPrisma.adoption.create.mockResolvedValue(mockAdoption);
      mockEvents.logEvent.mockResolvedValue({});

      const result = await service.requestAdoption(ADOPTER_ID, dto);

      expect(mockPrisma.adoption.create).toHaveBeenCalledWith({
        data: {
          petId: PET_ID,
          ownerId: OWNER_ID,
          adopterId: ADOPTER_ID,
          notes: undefined,
          status: AdoptionStatus.REQUESTED,
        },
      });

      expect(mockEvents.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: EventEntityType.ADOPTION,
          entityId: ADOPTION_ID,
          eventType: EventType.ADOPTION_REQUESTED,
          actorId: ADOPTER_ID,
        }),
      );

      expect(result).toEqual(mockAdoption);
    });

    it('throws NotFoundException when the pet does not exist', async () => {
      mockPrisma.pet.findUnique.mockResolvedValue(null);

      await expect(service.requestAdoption(ADOPTER_ID, dto)).rejects.toThrow(
        NotFoundException,
      );

      expect(mockPrisma.adoption.create).not.toHaveBeenCalled();
      expect(mockEvents.logEvent).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the pet has no owner assigned', async () => {
      mockPrisma.pet.findUnique.mockResolvedValue({ id: PET_ID, currentOwnerId: null });

      await expect(service.requestAdoption(ADOPTER_ID, dto)).rejects.toThrow(
        ConflictException,
      );

      expect(mockPrisma.adoption.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when there is an active adoption', async () => {
      mockPrisma.pet.findUnique.mockResolvedValue({ id: PET_ID, currentOwnerId: OWNER_ID });
      mockPrisma.adoption.findFirst.mockResolvedValue(mockAdoption);

      await expect(service.requestAdoption(ADOPTER_ID, dto)).rejects.toThrow(
        ConflictException,
      );

      expect(mockPrisma.adoption.create).not.toHaveBeenCalled();
    });

    it('propagates logEvent errors (no silent failure)', async () => {
      mockPrisma.pet.findUnique.mockResolvedValue({ id: PET_ID, currentOwnerId: OWNER_ID });
      mockPrisma.adoption.findFirst.mockResolvedValue(null);
      mockPrisma.adoption.create.mockResolvedValue(mockAdoption);
      mockEvents.logEvent.mockRejectedValue(new Error('DB connection lost'));

      await expect(service.requestAdoption(ADOPTER_ID, dto)).rejects.toThrow(
        'DB connection lost',
      );
    });
  });

  // ─── updateAdoptionStatus ─────────────────────────────

  describe('updateAdoptionStatus', () => {
    it('updates status to APPROVED and fires ADOPTION_APPROVED', async () => {
      const updated = { ...mockAdoption, status: AdoptionStatus.APPROVED };
      mockPrisma.adoption.findUnique.mockResolvedValue(mockAdoption);
      mockPrisma.adoption.update.mockResolvedValue(updated);
      mockEvents.logEvent.mockResolvedValue({});

      const result = await service.updateAdoptionStatus(ADOPTION_ID, ACTOR_ID, {
        status: 'APPROVED',
      });

      expect(mockPrisma.adoption.update).toHaveBeenCalledWith({
        where: { id: ADOPTION_ID },
        data: { status: 'APPROVED' },
      });

      expect(mockEvents.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: EventType.ADOPTION_APPROVED,
          entityId: ADOPTION_ID,
          actorId: ACTOR_ID,
        }),
      );

      expect(result.status).toBe(AdoptionStatus.APPROVED);
    });

    it('updates status to COMPLETED and fires ADOPTION_COMPLETED', async () => {
      const updated = { ...mockAdoption, status: AdoptionStatus.COMPLETED };
      mockPrisma.adoption.findUnique.mockResolvedValue(mockAdoption);
      mockPrisma.adoption.update.mockResolvedValue(updated);
      mockEvents.logEvent.mockResolvedValue({});

      await service.updateAdoptionStatus(ADOPTION_ID, ACTOR_ID, {
        status: 'COMPLETED',
      });

      expect(mockEvents.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: EventType.ADOPTION_COMPLETED,
        }),
      );
    });

    it('updates status to REJECTED without firing an event', async () => {
      const updated = { ...mockAdoption, status: AdoptionStatus.REJECTED };
      mockPrisma.adoption.findUnique.mockResolvedValue(mockAdoption);
      mockPrisma.adoption.update.mockResolvedValue(updated);

      await service.updateAdoptionStatus(ADOPTION_ID, ACTOR_ID, {
        status: 'REJECTED',
      });

      // REJECTED has no mapped EventType — logEvent should NOT be called
      expect(mockEvents.logEvent).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when adoption does not exist', async () => {
      mockPrisma.adoption.findUnique.mockResolvedValue(null);

      await expect(
        service.updateAdoptionStatus(ADOPTION_ID, ACTOR_ID, {
          status: 'APPROVED',
        }),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.adoption.update).not.toHaveBeenCalled();
      expect(mockEvents.logEvent).not.toHaveBeenCalled();
    });

    it('propagates logEvent errors (no silent failure)', async () => {
      const updated = { ...mockAdoption, status: AdoptionStatus.APPROVED };
      mockPrisma.adoption.findUnique.mockResolvedValue(mockAdoption);
      mockPrisma.adoption.update.mockResolvedValue(updated);
      mockEvents.logEvent.mockRejectedValue(
        new Error('Event store unavailable'),
      );

      await expect(
        service.updateAdoptionStatus(ADOPTION_ID, ACTOR_ID, {
          status: 'APPROVED',
        }),
      ).rejects.toThrow('Event store unavailable');
    });
  });
});
