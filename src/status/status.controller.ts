import {
  Controller,
  Get,
  Param,
  Req,
  Res,
  UseGuards,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiTags, ApiOperation, ApiParam, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StatusService, EntityType } from './status.service';
import { createHash } from 'crypto';

const VALID_ENTITY_TYPES = new Set<EntityType>(['ADOPTION', 'CUSTODY', 'ESCROW']);

function computeETag(data: unknown): string {
  return `"${createHash('sha1').update(JSON.stringify(data)).digest('hex').slice(0, 16)}"`;
}

@ApiTags('Status')
@Controller('status')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class StatusController {
  constructor(private readonly statusService: StatusService) {}

  @Get(':entityType/:id')
  @ApiOperation({ summary: 'Get unified status for an adoption, custody, or escrow' })
  @ApiParam({ name: 'entityType', enum: ['ADOPTION', 'CUSTODY', 'ESCROW'] })
  @ApiParam({ name: 'id', description: 'Entity ID' })
  @ApiResponse({ status: 200, description: 'Current status and step details' })
  @ApiResponse({ status: 304, description: 'Not modified (ETag matched)' })
  @ApiResponse({ status: 404, description: 'Entity not found' })
  async getStatus(
    @Param('entityType') rawEntityType: string,
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const entityType = rawEntityType.toUpperCase() as EntityType;

    if (!VALID_ENTITY_TYPES.has(entityType)) {
      res.status(HttpStatus.BAD_REQUEST).json({
        statusCode: 400,
        message: `Unknown entityType "${rawEntityType}". Valid values: ${[...VALID_ENTITY_TYPES].join(', ')}`,
      });
      return;
    }

    const status = await this.statusService.getStatus(entityType, id);
    const etag = computeETag(status);

    if (req.headers['if-none-match'] === etag) {
      res.status(HttpStatus.NOT_MODIFIED).end();
      return;
    }

    res
      .status(HttpStatus.OK)
      .set('ETag', etag)
      .set('Cache-Control', 'private, no-cache')
      .json(status);
  }
}
