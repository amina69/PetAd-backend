import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { AdoptionService } from './adoption.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { PetAvailabilityService } from '../pets/services/pet-availability.service';
import { EventType, EventEntityType, AdoptionStatus } from '@prisma/client';
import { PetStatus } from '../common/enums/pet-status.enum';

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

  const mockPetAvailabilityService = {
    resolve: jest.fn().mockResolvedValue(PetStatus.AVAILABLE),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPetAvailabilityService.resolve.mockResolvedValue(PetStatus.AVAILABLE);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdoptionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventsService, useValue: mockEvents },
        { provide: PetAvailabilityService, useValue: mockPetAvailabilityService },
      ],
    }).compile();

    service = module.get<AdoptionService>(AdoptionService);
  });

  // ─── requestAdoption ──────────────────────────────────

  describe('requestAdoption', () => {
    const dto = { petId: PET_ID, ownerId: OWNER_ID };

    it('creates the adoption record and fires ADOPTION_REQUESTED and PET_AVAILABILITY_CHANGED', async () => {
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

      // First call: ADOPTION_REQUESTED domain event
      expect(mockEvents.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: EventEntityType.ADOPTION,
          entityId: ADOPTION_ID,
          eventType: EventType.ADOPTION_REQUESTED,
          actorId: ADOPTER_ID,
        }),
      );

      // Second call: PET_AVAILABILITY_CHANGED audit event
      expect(mockEvents.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: EventEntityType.PET,
          entityId: PET_ID,
          eventType: EventType.PET_AVAILABILITY_CHANGED,
          actorId: ADOPTER_ID,
          payload: expect.objectContaining({
            newAvailability: 'PENDING',
            reason: 'adoption_requested',
          }),
        }),
      );

      expect(mockEvents.logEvent).toHaveBeenCalledTimes(2);
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
    it('updates status to APPROVED and fires ADOPTION_APPROVED only (no availability change)', async () => {
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

      // APPROVED does not affect availability (still PENDING), so only 1 event
      expect(mockEvents.logEvent).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(AdoptionStatus.APPROVED);
    });

    it('updates status to COMPLETED and fires ADOPTION_COMPLETED and PET_AVAILABILITY_CHANGED', async () => {
      const updated = { ...mockAdoption, status: AdoptionStatus.COMPLETED };
      mockPrisma.adoption.findUnique.mockResolvedValue(mockAdoption);
      mockPrisma.adoption.update.mockResolvedValue(updated);
      mockEvents.logEvent.mockResolvedValue({});
      mockPetAvailabilityService.resolve.mockResolvedValue(PetStatus.ADOPTED);

      await service.updateAdoptionStatus(ADOPTION_ID, ACTOR_ID, {
        status: 'COMPLETED',
      });

      expect(mockEvents.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: EventType.ADOPTION_COMPLETED,
        }),
      );
      expect(mockEvents.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: EventType.PET_AVAILABILITY_CHANGED,
          payload: expect.objectContaining({
            newAvailability: PetStatus.ADOPTED,
            reason: 'adoption_completed',
          }),
        }),
      );
      expect(mockEvents.logEvent).toHaveBeenCalledTimes(2);
    });

    it('updates status to REJECTED and fires PET_AVAILABILITY_CHANGED (no ADOPTION domain event)', async () => {
      const updated = { ...mockAdoption, status: AdoptionStatus.REJECTED };
      mockPrisma.adoption.findUnique.mockResolvedValue(mockAdoption);
      mockPrisma.adoption.update.mockResolvedValue(updated);
      mockEvents.logEvent.mockResolvedValue({});
      mockPetAvailabilityService.resolve.mockResolvedValue(PetStatus.AVAILABLE);

      await service.updateAdoptionStatus(ADOPTION_ID, ACTOR_ID, {
        status: 'REJECTED',
      });

      // REJECTED has no mapped adoption EventType, but does fire PET_AVAILABILITY_CHANGED
      expect(mockEvents.logEvent).toHaveBeenCalledTimes(1);
      expect(mockEvents.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: EventEntityType.PET,
          eventType: EventType.PET_AVAILABILITY_CHANGED,
          payload: expect.objectContaining({
            newAvailability: PetStatus.AVAILABLE,
            reason: 'adoption_rejected',
          }),
        }),
      );
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

  // ─── findAll ──────────────────────────────────────────

  describe('findAll', () => {
    it('returns an empty array if no adoptions match', async () => {
      mockPrisma.adoption.findMany.mockResolvedValue([]);
      const result = await service.findAll({ id: 'user-1', role: 'USER' }, {});
      expect(result).toEqual([]);
      expect(mockPrisma.adoption.findMany).toHaveBeenCalledWith({
        where: { adopterId: 'user-1' },
        orderBy: { createdAt: 'desc' },
        include: expect.any(Object),
      });
    });

    it('allows ADMIN to see all adoptions', async () => {
      mockPrisma.adoption.findMany.mockResolvedValue([mockAdoption]);
      const result = await service.findAll({ id: 'admin-1', role: 'ADMIN' }, { status: 'REQUESTED' });
      
      expect(mockPrisma.adoption.findMany).toHaveBeenCalledWith({
        where: { status: 'REQUESTED' },
        orderBy: { createdAt: 'desc' },
        include: expect.any(Object),
      });
      expect(result).toEqual([mockAdoption]);
    });

    it('restricts SHELTER to their own adoptions as owner', async () => {
      mockPrisma.adoption.findMany.mockResolvedValue([mockAdoption]);
      const result = await service.findAll({ id: 'shelter-1', role: 'SHELTER' }, { petId: 'pet-1' });

      expect(mockPrisma.adoption.findMany).toHaveBeenCalledWith({
        where: { petId: 'pet-1', ownerId: 'shelter-1' },
        orderBy: { createdAt: 'desc' },
        include: expect.any(Object),
      });
    });

    it('verifies that a USER cannot see another user\'s adoptions (forces adopterId to user.id)', async () => {
      mockPrisma.adoption.findMany.mockResolvedValue([mockAdoption]);
      const result = await service.findAll({ id: 'user-2', role: 'USER' }, {});

      expect(mockPrisma.adoption.findMany).toHaveBeenCalledWith({
        where: { adopterId: 'user-2' },
        orderBy: { createdAt: 'desc' },
        include: {
          pet: { select: { id: true, name: true, species: true, imageUrl: true } },
          adopter: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      });
      // the query directly uses the user.id from the JWT payload to filter, blocking unauthorized access.
    });
  });
});
