import {
  Controller,
  Get,
  Param,
  UseGuards,
  Req,
  Res,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CheckPolicy } from '../common/policies/check-policy.decorator';
import { PolicyAction, PolicySubject } from '../common/policies/policy.types';
import { DocumentsService } from './documents.service';
import type { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

@ApiTags('Documents')
@ApiBearerAuth('JWT-auth')
@Controller('documents')
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get(':id')
  @CheckPolicy(PolicyAction.READ, PolicySubject.DOCUMENT)
  @ApiOperation({
    summary: 'Get a document',
    description:
      'Readable by its uploader, the parties of the related adoption, or an admin. ' +
      'Any other caller gets 404 so the document is not disclosed.',
  })
  @ApiParam({ name: 'id', description: 'Document ID' })
  @ApiResponse({ status: 200, description: 'Document found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  getDocument(@Param('id') id: string) {
    return this.documentsService.findOne(id);
  }

  @Get(':id/download')
  @ApiOperation({
    summary: 'Download a scanned clean document',
    description: 'Downloads the file binary if scanned and authorized.',
  })
  async downloadDocument(
    @Param('id') id: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const user = req.user;
    const document = await this.documentsService.getDocumentForDownload(
      id,
      user.sub || user.userId,
      user.role,
    );

    const filePath = path.join(process.cwd(), 'uploads', `${document.id}-${document.fileName}`);
    if (fs.existsSync(filePath)) {
      return res.download(filePath, document.fileName);
    }

    throw new NotFoundException('File binary not found on server');
  }
}
