import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DataExportStatus } from '@prisma/client';

export class DataExportInitiatedDto {
  @ApiProperty({ example: '87f3b8e4-b77e-4076-a05e-57bba1ebf1e1' })
  id: string;

  @ApiProperty({ example: '87f3b8e4-b77e-4076-a05e-57bba1ebf1e1' })
  requestId: string;

  @ApiProperty({ enum: DataExportStatus, example: DataExportStatus.PENDING })
  status: DataExportStatus;

  @ApiProperty({ example: 'Data export request enqueued successfully' })
  message: string;
}

export class DataExportStatusResponseDto {
  @ApiProperty({ example: '87f3b8e4-b77e-4076-a05e-57bba1ebf1e1' })
  id: string;

  @ApiProperty({ enum: DataExportStatus, example: DataExportStatus.COMPLETED })
  status: DataExportStatus;

  @ApiPropertyOptional({
    example: '/users/me/data-export/87f3b8e4.../download?expires=...&sig=...',
  })
  downloadUrl?: string;

  @ApiPropertyOptional({
    example: '2026-10-29T12:00:00.000Z',
    description: 'Expiration date of the export file (7 days)',
  })
  expiresAt?: string;

  @ApiPropertyOptional({
    example: '2026-10-22T13:15:00.000Z',
    description: 'Expiration date of the signed download link (15 minutes)',
  })
  linkExpiresAt?: string;

  @ApiProperty({ example: '2026-10-22T13:00:00.000Z' })
  createdAt: string;

  @ApiPropertyOptional({ example: 'File auto-purged after 7 days' })
  message?: string;

  @ApiPropertyOptional({ example: 'Failed to process export' })
  error?: string;
}
