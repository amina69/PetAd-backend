import { Test, TestingModule } from '@nestjs/testing';
import { EscrowService } from './escrow.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { NotFoundException } from '@nestjs/common';
import { EscrowStatus, AdoptionStatus, EventType, EventEntityType } from '@prisma/client';

describe('EscrowService', () => {
    let service: EscrowService;
    let prismaService: PrismaService;
    let eventsService: EventsService;

    const mockPrismaService = {
        escrow: {
            create: jest.fn(),
            findUnique: jest.fn(),
            update: jest.fn(),
        },
        adoption: {
            update: jest.fn(),
        },
        pet: {
            update: jest.fn(),
        },
        $transaction: jest.fn((callback) => callback(mockPrismaService)),
    };

    const mockEventsService = {
        logEvent: jest.fn(),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                EscrowService,
                { provide: PrismaService, useValue: mockPrismaService },
                { provide: EventsService, useValue: mockEventsService },
            ],
        }).compile();

        service = module.get<EscrowService>(EscrowService);
        prismaService = module.get<PrismaService>(PrismaService);
        eventsService = module.get<EventsService>(EventsService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('releaseEscrow', () => {
        const escrowId = 'escrow-123';
        const txHash = 'tx-hash-abc';

        it('should throw NotFoundException if escrow does not exist', async () => {
            mockPrismaService.escrow.findUnique.mockResolvedValueOnce(null);

            await expect(service.releaseEscrow(escrowId, txHash)).rejects.toThrow(NotFoundException);
        });

        it('should release escrow and not update adoption if no adoption is attached', async () => {
            const mockEscrow = {
                id: escrowId,
                amount: 100,
                status: EscrowStatus.CREATED,
            };

            mockPrismaService.escrow.findUnique.mockResolvedValueOnce(mockEscrow);
            mockPrismaService.escrow.update.mockResolvedValueOnce({ ...mockEscrow, status: EscrowStatus.RELEASED });

            const result = await service.releaseEscrow(escrowId, txHash);

            expect(mockPrismaService.escrow.update).toHaveBeenCalledWith({
                where: { id: escrowId },
                data: { status: EscrowStatus.RELEASED, releaseTxHash: txHash },
            });

            expect(mockEventsService.logEvent).toHaveBeenCalledWith({
                entityType: EventEntityType.ESCROW,
                entityId: escrowId,
                eventType: EventType.ESCROW_RELEASED,
                txHash,
                payload: { amount: 100 },
            });

            expect(mockPrismaService.adoption.update).not.toHaveBeenCalled();
            expect(result.status).toBe(EscrowStatus.RELEASED);
        });

        it('should release escrow and update adoption and pet if adoption is attached', async () => {
            const mockAdoption = {
                id: 'adoption-123',
                petId: 'pet-123',
                adopterId: 'adopter-123',
            };

            const mockEscrow = {
                id: escrowId,
                amount: 100,
                status: EscrowStatus.CREATED,
                adoption: mockAdoption,
            };

            mockPrismaService.escrow.findUnique.mockResolvedValueOnce(mockEscrow);
            mockPrismaService.escrow.update.mockResolvedValueOnce({ ...mockEscrow, status: EscrowStatus.RELEASED });

            const result = await service.releaseEscrow(escrowId, txHash);

            expect(mockPrismaService.adoption.update).toHaveBeenCalledWith({
                where: { id: mockAdoption.id },
                data: { status: AdoptionStatus.COMPLETED },
            });

            expect(mockPrismaService.pet.update).toHaveBeenCalledWith({
                where: { id: mockAdoption.petId },
                data: { currentOwnerId: mockAdoption.adopterId },
            });

            expect(mockEventsService.logEvent).toHaveBeenCalledWith({
                entityType: EventEntityType.ADOPTION,
                entityId: mockAdoption.id,
                eventType: EventType.ADOPTION_COMPLETED,
                payload: { escrowId, petId: mockAdoption.petId },
            });

            expect(result.status).toBe(EscrowStatus.RELEASED);
        });
    });
});
