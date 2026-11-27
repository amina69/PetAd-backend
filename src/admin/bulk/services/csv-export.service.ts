import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { PrismaService } from '../../../prisma/prisma.service';
import { CsvResource } from '../dto/csv-export-query.dto';

export const CSV_BATCH_SIZE = 500;

const HEADERS: Record<CsvResource, readonly string[]> = {
  [CsvResource.ADOPTIONS]: [
    'id',
    'status',
    'petId',
    'adopterId',
    'ownerId',
    'notes',
    'createdAt',
  ],
  [CsvResource.DOCUMENTS]: [
    'id',
    'fileName',
    'mimeType',
    'size',
    'verificationStatus',
    'adoptionId',
    'createdAt',
  ],
  [CsvResource.PETS]: [
    'id',
    'name',
    'species',
    'status',
    'archivedAt',
    'createdAt',
  ],
  [CsvResource.USERS]: [
    'id',
    'email',
    'firstName',
    'lastName',
    'role',
    'status',
    'createdAt',
  ],
};

export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  if (typeof value === 'number') return String(value);

  let raw: string;
  if (value instanceof Date) {
    raw = value.toISOString();
  } else if (typeof value === 'object') {
    raw = JSON.stringify(value);
  } else if (typeof value === 'string') {
    raw = value;
  } else if (typeof value === 'bigint' || typeof value === 'boolean') {
    raw = value.toString();
  } else {
    raw = '';
  }

  const text = raw.replace(/\r?\n/g, ' ').replace(/\r/g, ' ');
  const safe = /^\s*[=+\-@\t\r]/.test(text) ? `'${text}` : text;

  return `"${safe.replace(/"/g, '""')}"`;
}

type CsvRecord = Record<string, unknown> & { id: string };

@Injectable()
export class CsvExportService {
  constructor(private readonly prisma: PrismaService) {}

  async stream(resource: CsvResource, response: Response): Promise<void> {
    response.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${resource}.csv"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });

    const stream = Readable.from(this.generateRows(resource));

    try {
      await pipeline(stream, response);
    } catch (error) {
      if (!response.destroyed) throw error;
    }
  }

  async *generateRows(resource: CsvResource): AsyncGenerator<string> {
    const headers = HEADERS[resource];
    yield `${headers.map((header) => escapeCsvCell(header)).join(',')}\r\n`;

    let cursor: string | undefined;
    for (;;) {
      const batch = await this.fetchBatch(resource, cursor);
      if (batch.length === 0) return;

      for (const record of batch) {
        const cells = headers.map((header) => escapeCsvCell(record[header]));
        yield `${cells.join(',')}\r\n`;
        cursor = record.id;
      }

      if (batch.length < CSV_BATCH_SIZE) return;
    }
  }

  private async fetchBatch(
    resource: CsvResource,
    cursor?: string,
  ): Promise<CsvRecord[]> {
    const pagination = {
      take: CSV_BATCH_SIZE,
      orderBy: { id: 'asc' as const },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    };

    switch (resource) {
      case CsvResource.ADOPTIONS:
        return this.prisma.adoption.findMany({
          ...pagination,
          select: {
            id: true,
            status: true,
            petId: true,
            adopterId: true,
            ownerId: true,
            notes: true,
            createdAt: true,
          },
        });
      case CsvResource.DOCUMENTS:
        return this.prisma.document.findMany({
          ...pagination,
          select: {
            id: true,
            fileName: true,
            mimeType: true,
            size: true,
            verificationStatus: true,
            adoptionId: true,
            createdAt: true,
          },
        });
      case CsvResource.PETS:
        return this.prisma.pet.findMany({
          ...pagination,
          select: {
            id: true,
            name: true,
            species: true,
            status: true,
            archivedAt: true,
            createdAt: true,
          },
        });
      case CsvResource.USERS:
        return this.prisma.user.findMany({
          ...pagination,
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            status: true,
            createdAt: true,
          },
        });
    }
  }
}
