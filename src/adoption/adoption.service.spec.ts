import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { AdoptionService } from './adoption.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { AdoptionStateMachine } from './services/adoption-state-machine.service';
import { PetAvailabilityService } from '../pets/services/pet-availability.service';
import { EventType, EventEntityType, AdoptionStatus } from '@prisma/client';
import { DomainException } from '../common/exceptions/domain.exception';
import { PetStatus } from '../common/enums';

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
      findMany: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn().mockImplementation(async (cb) => cb(mockPrisma)),
  };

  const mockEvents = {
    logEvent: jest.fn(),
  };

  const mockStateMachine = {
    assertValidTransition: jest.fn(),
    canTransition: jest.fn(),
  };

  const mockPetAvailabilityService = {
    resolve: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPetAvailabilityService.resolve.mockResolvedValue(PetStatus.AVAILABLE);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdoptionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventsService, useValue: mockEvents },
        { provide: AdoptionStateMachine, useValue: mockStateMachine },
        { provide: PetAvailabilityService, useValue: mockPetAvailabilityService },
      ],
    }).compile();

    service = module.get<AdoptionService>(AdoptionService);
  });

  // ─── requestAdoption ──────────────────────────────────

  describe('requestAdoption', () => {
    const dto = { petId: PET_ID, ownerId: OWNER_ID };

    it('creates the adoption record and fires ADOPTION_REQUESTED + PET_AVAILABILITY_CHANGED', async () => {
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

      expect(mockEvents.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: EventEntityType.PET,
          entityId: PET_ID,
          eventType: EventType.PET_AVAILABILITY_CHANGED,
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

      expect(mockStateMachine.assertValidTransition).toHaveBeenCalledWith(
        mockAdoption.status,
        'APPROVED',
      );

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

    it('updates status to COMPLETED and fires ADOPTION_COMPLETED + PET_AVAILABILITY_CHANGED', async () => {
      const updated = { ...mockAdoption, status: AdoptionStatus.COMPLETED };
      mockPrisma.adoption.findUnique.mockResolvedValue(mockAdoption);
      mockPrisma.adoption.update.mockResolvedValue(updated);
      mockEvents.logEvent.mockResolvedValue({});
      mockPetAvailabilityService.resolve.mockResolvedValue(PetStatus.ADOPTED);

      await service.updateAdoptionStatus(ADOPTION_ID, ACTOR_ID, {
        status: 'COMPLETED',
      });

      expect(mockStateMachine.assertValidTransition).toHaveBeenCalledWith(
        mockAdoption.status,
        'COMPLETED',
      );

      expect(mockEvents.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: EventType.ADOPTION_COMPLETED,
        }),
      );

      expect(mockEvents.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: EventEntityType.PET,
          eventType: EventType.PET_AVAILABILITY_CHANGED,
          payload: expect.objectContaining({
            newAvailability: PetStatus.ADOPTED,
          }),
        }),
      );
    });

    it('updates status to REJECTED and fires PET_AVAILABILITY_CHANGED', async () => {
      const updated = { ...mockAdoption, status: AdoptionStatus.REJECTED };
      mockPrisma.adoption.findUnique.mockResolvedValue(mockAdoption);
      mockPrisma.adoption.update.mockResolvedValue(updated);
      mockPetAvailabilityService.resolve.mockResolvedValue(PetStatus.AVAILABLE);

      await service.updateAdoptionStatus(ADOPTION_ID, ACTOR_ID, {
        status: 'REJECTED',
      });

      expect(mockStateMachine.assertValidTransition).toHaveBeenCalledWith(
        mockAdoption.status,
        'REJECTED',
      );

      expect(mockEvents.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: EventEntityType.PET,
          eventType: EventType.PET_AVAILABILITY_CHANGED,
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

    it('throws DomainException when state machine rejects the transition', async () => {
      const domainError = new DomainException('Invalid transition');
      mockPrisma.adoption.findUnique.mockResolvedValue(mockAdoption);
      mockStateMachine.assertValidTransition.mockImplementationOnce(() => {
        throw domainError;
      });

      await expect(
        service.updateAdoptionStatus(ADOPTION_ID, ACTOR_ID, {
          status: 'COMPLETED',
        }),
      ).rejects.toThrow(domainError);

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

  // ─── approveAdoption ──────────────────────────────────

  describe('approveAdoption', () => {
    const pendingAdoption = {
      ...mockAdoption,
      status: AdoptionStatus.PENDING,
      pet: { id: PET_ID, name: 'Buddy', species: 'DOG' },
      adopter: { id: ADOPTER_ID, email: 'adopter@test.com', firstName: 'John', lastName: 'Doe' },
    };

    const approvedAdoption = {
      ...pendingAdoption,
      status: AdoptionStatus.APPROVED,
      owner: { id: OWNER_ID, email: 'owner@test.com', firstName: 'Jane', lastName: 'Smith' },
    };

    it('approves a PENDING adoption and fires ADOPTION_APPROVED event', async () => {
      mockPrisma.adoption.findUnique.mockResolvedValue(pendingAdoption);
      mockPrisma.adoption.update.mockResolvedValue(approvedAdoption);
      mockEvents.logEvent.mockResolvedValue({});

      const result = await service.approveAdoption(ADOPTION_ID, ACTOR_ID);

      expect(mockStateMachine.assertValidTransition).toHaveBeenCalledWith(
        AdoptionStatus.PENDING,
        AdoptionStatus.APPROVED,
      );

      expect(mockPrisma.adoption.update).toHaveBeenCalledWith({
        where: { id: ADOPTION_ID },
        data: { status: AdoptionStatus.APPROVED },
        include: expect.any(Object),
      });

      expect(mockEvents.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: EventEntityType.ADOPTION,
          entityId: ADOPTION_ID,
          eventType: EventType.ADOPTION_APPROVED,
          actorId: ACTOR_ID,
        }),
      );

      expect(result.status).toBe(AdoptionStatus.APPROVED);
    });

    it('throws NotFoundException when adoption does not exist', async () => {
      mockPrisma.adoption.findUnique.mockResolvedValue(null);

      await expect(
        service.approveAdoption(ADOPTION_ID, ACTOR_ID),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.adoption.update).not.toHaveBeenCalled();
      expect(mockEvents.logEvent).not.toHaveBeenCalled();
    });

    it('throws DomainException when adoption is not PENDING', async () => {
      const completedAdoption = { ...mockAdoption, status: AdoptionStatus.COMPLETED };
      mockPrisma.adoption.findUnique.mockResolvedValue(completedAdoption);
      
      const domainError = new DomainException('Invalid transition');
      mockStateMachine.assertValidTransition.mockImplementationOnce(() => {
        throw domainError;
      });

      await expect(
        service.approveAdoption(ADOPTION_ID, ACTOR_ID),
      ).rejects.toThrow(DomainException);

      expect(mockPrisma.adoption.update).not.toHaveBeenCalled();
    });
  });

  // ─── rejectAdoption ───────────────────────────────────

  describe('rejectAdoption', () => {
    const pendingAdoption = {
      ...mockAdoption,
      status: AdoptionStatus.PENDING,
      pet: { id: PET_ID, name: 'Buddy', species: 'DOG' },
      adopter: { id: ADOPTER_ID, email: 'adopter@test.com', firstName: 'John', lastName: 'Doe' },
    };

    const rejectedAdoption = {
      ...pendingAdoption,
      status: AdoptionStatus.REJECTED,
      notes: '[REJECTED] Incomplete documentation',
      owner: { id: OWNER_ID, email: 'owner@test.com', firstName: 'Jane', lastName: 'Smith' },
    };

    it('rejects a PENDING adoption with reason', async () => {
      mockPrisma.adoption.findUnique.mockResolvedValue(pendingAdoption);
      mockPrisma.adoption.update.mockResolvedValue(rejectedAdoption);

      const result = await service.rejectAdoption(ADOPTION_ID, ACTOR_ID, {
        reason: 'Incomplete documentation',
      });

      expect(mockStateMachine.assertValidTransition).toHaveBeenCalledWith(
        AdoptionStatus.PENDING,
        AdoptionStatus.REJECTED,
      );

      expect(mockPrisma.adoption.update).toHaveBeenCalledWith({
        where: { id: ADOPTION_ID },
        data: {
          status: AdoptionStatus.REJECTED,
          notes: '[REJECTED] Incomplete documentation',
        },
        include: expect.any(Object),
      });

      expect(result.status).toBe(AdoptionStatus.REJECTED);
    });

    it('rejects a PENDING adoption without reason', async () => {
      mockPrisma.adoption.findUnique.mockResolvedValue(pendingAdoption);
      mockPrisma.adoption.update.mockResolvedValue({
        ...pendingAdoption,
        status: AdoptionStatus.REJECTED,
      });

      const result = await service.rejectAdoption(ADOPTION_ID, ACTOR_ID, {});

      expect(mockPrisma.adoption.update).toHaveBeenCalledWith({
        where: { id: ADOPTION_ID },
        data: {
          status: AdoptionStatus.REJECTED,
          notes: null,
        },
        include: expect.any(Object),
      });

      expect(result.status).toBe(AdoptionStatus.REJECTED);
    });

    it('appends rejection reason to existing notes', async () => {
      const adoptionWithNotes = {
        ...pendingAdoption,
        notes: 'Initial request notes',
      };
      mockPrisma.adoption.findUnique.mockResolvedValue(adoptionWithNotes);
      mockPrisma.adoption.update.mockResolvedValue({
        ...adoptionWithNotes,
        status: AdoptionStatus.REJECTED,
        notes: 'Initial request notes\n\n[REJECTED] Missing documents',
      });

      await service.rejectAdoption(ADOPTION_ID, ACTOR_ID, {
        reason: 'Missing documents',
      });

      expect(mockPrisma.adoption.update).toHaveBeenCalledWith({
        where: { id: ADOPTION_ID },
        data: {
          status: AdoptionStatus.REJECTED,
          notes: 'Initial request notes\n\n[REJECTED] Missing documents',
        },
        include: expect.any(Object),
      });
    });

    it('throws NotFoundException when adoption does not exist', async () => {
      mockPrisma.adoption.findUnique.mockResolvedValue(null);

      await expect(
        service.rejectAdoption(ADOPTION_ID, ACTOR_ID, {}),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.adoption.update).not.toHaveBeenCalled();
    });

    it('throws DomainException when adoption is not PENDING', async () => {
      const approvedAdoption = { ...mockAdoption, status: AdoptionStatus.APPROVED };
      mockPrisma.adoption.findUnique.mockResolvedValue(approvedAdoption);
      
      const domainError = new DomainException('Invalid transition');
      mockStateMachine.assertValidTransition.mockImplementationOnce(() => {
        throw domainError;
      });

      await expect(
        service.rejectAdoption(ADOPTION_ID, ACTOR_ID, {}),
      ).rejects.toThrow(DomainException);

      expect(mockPrisma.adoption.update).not.toHaveBeenCalled();
    });
  });
});
