import { Controller, Get, Param, UseGuards } from '@nestjs/common';
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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';

@ApiTags('Documents')
@ApiBearerAuth('JWT-auth')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.USER, Role.SHELTER)
  @CheckPolicy(PolicyAction.READ, PolicySubject.DOCUMENT)
  @ApiOperation({
    summary: 'Get a document',
    description:
      'Readable by its uploader, counterparties of the linked adoption/custody, assigned admins/reviewers, or dispute participants. ' +
      'Admins require the ADMIN role at request time. Sensitive kinds trigger DOCUMENT_ACCESSED audit events.',
  })
  @ApiParam({ name: 'id', description: 'Document ID' })
  @ApiResponse({ status: 200, description: 'Document found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  getDocument(@Param('id') id: string, @CurrentUser() user: any) {
    return this.documentsService.findOne(id, user?.userId || user?.sub, user?.role);
  }
}
