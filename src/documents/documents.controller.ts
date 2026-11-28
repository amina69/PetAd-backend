import { Controller, Get, Post, Param, Body, Query, UseGuards, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { CheckPolicy } from '../common/policies/check-policy.decorator';
import { PolicyAction, PolicySubject } from '../common/policies/policy.types';
import { DocumentsService } from './documents.service';
import { Request } from 'express';
import { IsString, IsNotEmpty } from 'class-validator';

export class RejectDocumentDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}

interface AuthRequest extends Request {
  user: { userId: string; email: string; role: string; sub?: string };
}

interface AuthRequest extends Request {
  user: {
    userId?: string;
    sub?: string;
    role?: string;
  };
}

@ApiTags('Documents')
@ApiBearerAuth('JWT-auth')
@Controller('documents')
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

@Get('admin')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Get documents queue (Admin only)',
    description: 'Lists documents optionally filtered by status (e.g. PENDING).',
  })
  @ApiQuery({ name: 'status', required: false, description: 'Document status filter' })
  @ApiResponse({ status: 200, description: 'Documents queue retrieved' })
  getAdminDocumentsQueue(@Query('status') status?: string) {
    return this.documentsService.findAll(status);
  }

  @Post(':id/verify')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Verify a document (Admin only)' })
  @ApiResponse({ status: 200, description: 'Document verified successfully' })
  verifyDocument(@Req() req: AuthRequest, @Param('id') id: string) {
    const adminId = req.user?.userId ?? req.user?.sub ?? '';
    return this.documentsService.verifyDocument(id, adminId);
  }

  @Post(':id/verify-integrity')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Verify document integrity (Admin only)',
    description: 'Re-hashes the stored object and reports match/mismatch.',
  })
  @ApiParam({ name: 'id', description: 'Document ID' })
  @ApiResponse({ status: 200, description: 'Integrity verified' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  verifyIntegrity(@Param('id') id: string, @Req() req: AuthRequest) {
    const actorId = req.user?.userId ?? req.user?.sub ?? 'admin';
    return this.documentsService.verifyIntegrity(id, actorId);
  }

  @Post(':id/reject')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Reject a document with reason (Admin only)' })
  @ApiResponse({ status: 200, description: 'Document rejected successfully' })
  rejectDocument(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() dto: RejectDocumentDto,
  ) {
    const adminId = req.user?.userId ?? req.user?.sub ?? '';
    return this.documentsService.rejectDocument(id, adminId, dto.reason);
  }
  @Get(':id')
  @CheckPolicy(PolicyAction.READ, PolicySubject.DOCUMENT)
  @ApiOperation({
    summary: 'Get a document',
    description:
      'Readable by its uploader, the parties of the related adoption, or an admin.',
  })
  @ApiParam({ name: 'id', description: 'Document ID' })
  @ApiResponse({ status: 200, description: 'Document found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  getDocument(@Param('id') id: string) {
    return this.documentsService.findOne(id);
  }
}
