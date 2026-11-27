import { Test, TestingModule } from '@nestjs/testing';
import { DocumentVerificationStatus } from '@prisma/client';
import { BulkActionsService } from './bulk-actions.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { LoggingService } from '../../../logging/logging.service';
import { AdoptionService } from '../../../adoption/adoption.service';
import { BulkAction, BulkResource } from '../dto/bulk-action.dto';

describe('BulkActionsService', () => {
  let service: BulkActionsService;
  let logging: { log: jest.Mock };
  let document: { findUnique: jest.Mock; update: jest.Mock };
  let pet: { findUnique: jest.Mock; update: jest.Mock };
  let adoptionService: {
    approveAdoption: jest.Mock;
    rejectAdoption: jest.Mock;
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    document = {
      findUnique: jest
        .fn()
        .mockImplementation((args: { where: { id: string } }) => {
          const id = args.where.id;
          return Promise.resolve(
            id === 'missing'
              ? null
              : {
                  id,
                  verificationStatus: DocumentVerificationStatus.PENDING,
                },
          );
        }),
      update: jest.fn().mockResolvedValue({}),
    };
    pet = {
      findUnique: jest
        .fn()
        .mockImplementation((args: { where: { id: string } }) => {
          const id = args.where.id;
          return Promise.resolve(
            id === 'missing' ? null : { id, archivedAt: null },
          );
        }),
      update: jest.fn().mockResolvedValue({}),
    };
    adoptionService = {
      approveAdoption: jest.fn().mockResolvedValue({}),
      rejectAdoption: jest.fn().mockResolvedValue({}),
    };
    logging = { log: jest.fn().mockResolvedValue({ id: 'log-1' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BulkActionsService,
        { provide: PrismaService, useValue: { document, pet } },
        { provide: LoggingService, useValue: logging },
        { provide: AdoptionService, useValue: adoptionService },
      ],
    }).compile();

    service = module.get(BulkActionsService);
  });

  it('continues after an invalid item and reports each result', async () => {
    const result = await service.execute(
      BulkResource.DOCUMENTS,
      BulkAction.VERIFY,
      { ids: ['doc-1', 'missing', 'doc-2'], reason: 'Passport checked' },
      'admin-1',
    );

    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.results).toEqual([
      { id: 'doc-1', success: true },
      {
        id: 'missing',
        success: false,
        error: expect.stringContaining('not found') as string,
      },
      { id: 'doc-2', success: true },
    ]);
    expect(document.update).toHaveBeenCalledTimes(2);
    expect(logging.log).toHaveBeenCalledTimes(3);
    expect(logging.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'BULK_DOCUMENT_VERIFY_FAILED',
        userId: 'admin-1',
        metadata: expect.objectContaining({
          itemId: 'missing',
          success: false,
        }) as Record<string, unknown>,
      }) as Record<string, unknown>,
    );
  });

  it('archives pets with the required reason recorded in the audit', async () => {
    const result = await service.execute(
      BulkResource.PETS,
      BulkAction.ARCHIVE,
      { ids: ['pet-1'], reason: 'Duplicate listing' },
      'admin-2',
    );

    expect(result.succeeded).toBe(1);
    expect(pet.update).toHaveBeenCalledWith({
      where: { id: 'pet-1' },
      data: expect.objectContaining({
        archiveReason: 'Duplicate listing',
      }) as Record<string, unknown>,
    });
    expect(logging.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'BULK_PET_ARCHIVE_SUCCEEDED',
        metadata: expect.objectContaining({
          reason: 'Duplicate listing',
        }) as Record<string, unknown>,
      }) as Record<string, unknown>,
    );
  });

  it('rejects unsupported resource/action combinations', async () => {
    await expect(
      service.execute(
        BulkResource.PETS,
        BulkAction.VERIFY,
        { ids: ['pet-1'], reason: 'nope' },
        'admin-2',
      ),
    ).rejects.toThrow('not supported');
    expect(pet.update).not.toHaveBeenCalled();
  });
});
