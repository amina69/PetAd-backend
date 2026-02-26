import { ApiProperty } from '@nestjs/swagger';

/**
 * Pagination Metadata
 * Contains information about the current page and total results
 */
export class PaginationMetaDto {
  @ApiProperty({ example: 1, description: 'Current page number' })
  page: number;

  @ApiProperty({ example: 20, description: 'Items per page' })
  limit: number;

  @ApiProperty({ example: 150, description: 'Total number of items' })
  total: number;

  @ApiProperty({ example: 8, description: 'Total number of pages' })
  totalPages: number;

  @ApiProperty({
    example: true,
    description: 'Whether there is a next page',
  })
  hasNextPage: boolean;

  @ApiProperty({
    example: false,
    description: 'Whether there is a previous page',
  })
  hasPreviousPage: boolean;

  constructor(page: number, limit: number, total: number) {
    this.page = page;
    this.limit = limit;
    this.total = total;
    this.totalPages = Math.ceil(total / limit) || 0;
    this.hasNextPage = page < this.totalPages;
    this.hasPreviousPage = page > 1;
  }
}

/**
 * Generic Paginated Response Wrapper
 * Wraps any data type with pagination metadata
 * @template T - The type of data being paginated
 */
export class PaginatedResponseDto<T> {
  @ApiProperty({ description: 'Array of data items' })
  data: T[];

  @ApiProperty({
    description: 'Pagination metadata',
    type: () => PaginationMetaDto,
  })
  meta: PaginationMetaDto;

  constructor(data: T[], meta: PaginationMetaDto) {
    this.data = data;
    this.meta = meta;
  }
}
