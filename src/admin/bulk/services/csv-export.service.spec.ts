import { Test, TestingModule } from '@nestjs/testing';
import {
  CsvExportService,
  CSV_BATCH_SIZE,
  escapeCsvCell,
} from './csv-export.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CsvResource } from '../dto/csv-export-query.dto';

describe('CsvExportService', () => {
  let service: CsvExportService;
  let findMany: jest.Mock;

  beforeEach(async () => {
    findMany = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CsvExportService,
        { provide: PrismaService, useValue: { document: { findMany } } },
      ],
    }).compile();
    service = module.get(CsvExportService);
  });

  it('neutralises spreadsheet formula injection and quotes cells', () => {
    expect(escapeCsvCell('=HYPERLINK("http://evil")')).toBe(
      '"\'=HYPERLINK(""http://evil"")"',
    );
    expect(escapeCsvCell('  @SUM(A1:A9)')).toBe('"\'  @SUM(A1:A9)"');
    expect(escapeCsvCell('-2')).toBe(`"'-2"`);
    expect(escapeCsvCell(42)).toBe('42');
    expect(escapeCsvCell(null)).toBe('""');
    expect(escapeCsvCell('a,b\nnext')).toBe('"a,b next"');
  });

  it('streams rows in bounded cursor-paginated batches', async () => {
    const firstBatch = Array.from({ length: CSV_BATCH_SIZE }, (_, index) => ({
      id: `doc-${index}`,
      fileName: '=cmd.csv',
      mimeType: 'text/csv',
      size: 10,
      verificationStatus: 'PENDING',
      adoptionId: 'adoption-1',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    }));
    const secondBatch = [
      {
        ...firstBatch[0],
        id: `doc-${CSV_BATCH_SIZE}`,
      },
    ];

    findMany
      .mockResolvedValueOnce(firstBatch)
      .mockResolvedValueOnce(secondBatch);

    const lines: string[] = [];
    for await (const chunk of service.generateRows(CsvResource.DOCUMENTS)) {
      lines.push(chunk);
    }

    expect(lines[0]).toContain('"fileName"');
    expect(lines).toHaveLength(CSV_BATCH_SIZE + 2);
    expect(lines[1]).toContain('"\'=cmd.csv"');
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ take: CSV_BATCH_SIZE, orderBy: { id: 'asc' } }),
    );
    expect(findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        cursor: { id: `doc-${CSV_BATCH_SIZE - 1}` },
        skip: 1,
      }),
    );
  });
});
