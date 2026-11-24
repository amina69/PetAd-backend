import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DisputeStatus, EventEntityType, EventType } from '@prisma/client';
import { DisputeEvidenceService, MAX_EVIDENCE_FILES } from './dispute-evidence.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';

const ACTOR_ID = 'user-filer';
const DISPUTE_ID = 'dispute-1';
const DOC_ID = 'doc-1';

function makeDispute(overrides: Record<string, unknown> = {}) {
  return {
    id: DISPUTE_ID,
    filedById: ACTOR_ID,
    status: DisputeStatus.OPEN,
    evidence: [] as { id: string }[],
    adoption: { id: 'adop-1', adopterId: ACTOR_ID, ownerId: 'user-owner' },
    custody: null,
    ...overrides,
  };
}

function makeDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: DOC_ID,
    uploadedById: ACTOR_ID,
    fileUrl: 'https://cdn.example.com/file.pdf',
    publicId: 'uploads/file',
    ...overrides,
  };
}

describe('DisputeEvidenceService', () => {
  let service: DisputeEvidenceService;

  const txMock = {
    disputeEvidence: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };

  const mockPrisma = {
    dispute: { findUnique: jest.fn() },
    document: { findMany: jest.fn() },
    $transaction: jest.fn((cb: (tx: unknown) => Promise<void>) => cb(txMock)),
  };

  const mockEvents = { logEvent: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DisputeEvidenceService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventsService, useValue: mockEvents },
      ],
    }).compile();
    service = module.get<DisputeEvidenceService>(DisputeEvidenceService);
  });

  it('throws BadRequestException when documentIds is empty', async () => {
    await expect(
      service.attachEvidence({ disputeId: DISPUTE_ID, documentIds: [], actorId: ACTOR_ID }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws NotFoundException when dispute is missing', async () => {
    mockPrisma.dispute.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.attachEvidence({ disputeId: 'missing', documentIds: [DOC_ID], actorId: ACTOR_ID }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws ForbiddenException when actor is not a party', async () => {
    mockPrisma.dispute.findUnique.mockResolvedValueOnce(
      makeDispute({ filedById: 'other', adoption: null }),
    );
    await expect(
      service.attachEvidence({ disputeId: DISPUTE_ID, documentIds: [DOC_ID], actorId: 'stranger' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws ConflictException when dispute is RESOLVED', async () => {
    mockPrisma.dispute.findUnique.mockResolvedValueOnce(
      makeDispute({ status: DisputeStatus.RESOLVED }),
    );
    await expect(
      service.attachEvidence({ disputeId: DISPUTE_ID, documentIds: [DOC_ID], actorId: ACTOR_ID }),
    ).rejects.toThrow(ConflictException);
  });

  it('throws BadRequestException when over the evidence limit', async () => {
    const existing = Array.from({ length: MAX_EVIDENCE_FILES }, (_, i) => ({ id: `ev-${i}` }));
    mockPrisma.dispute.findUnique.mockResolvedValueOnce(makeDispute({ evidence: existing }));
    await expect(
      service.attachEvidence({ disputeId: DISPUTE_ID, documentIds: [DOC_ID], actorId: ACTOR_ID }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws NotFoundException when a document is not found', async () => {
    mockPrisma.dispute.findUnique.mockResolvedValueOnce(makeDispute());
    mockPrisma.document.findMany.mockResolvedValueOnce([]);
    await expect(
      service.attachEvidence({ disputeId: DISPUTE_ID, documentIds: [DOC_ID], actorId: ACTOR_ID }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws ForbiddenException when document belongs to another user', async () => {
    mockPrisma.dispute.findUnique.mockResolvedValueOnce(makeDispute());
    mockPrisma.document.findMany.mockResolvedValueOnce([
      makeDocument({ uploadedById: 'other-user' }),
    ]);
    await expect(
      service.attachEvidence({ disputeId: DISPUTE_ID, documentIds: [DOC_ID], actorId: ACTOR_ID }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('creates evidence rows and emits DISPUTE_EVIDENCE_ADDED with fileHash', async () => {
    mockPrisma.dispute.findUnique.mockResolvedValueOnce(makeDispute());
    const doc = makeDocument();
    mockPrisma.document.findMany.mockResolvedValueOnce([doc]);
    mockEvents.logEvent.mockResolvedValue(undefined);

    await service.attachEvidence({
      disputeId: DISPUTE_ID,
      documentIds: [DOC_ID],
      actorId: ACTOR_ID,
    });

    expect(mockEvents.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: EventEntityType.DISPUTE,
        entityId: DISPUTE_ID,
        eventType: EventType.DISPUTE_EVIDENCE_ADDED,
        actorId: ACTOR_ID,
        payload: expect.objectContaining({ documentId: DOC_ID, fileHash: expect.any(String) }),
      }),
    );

    const call = mockEvents.logEvent.mock.calls[0][0];
    expect(call.payload.fileHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
