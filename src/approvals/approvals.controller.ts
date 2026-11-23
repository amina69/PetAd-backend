import {
  Controller,
  Post,
  Patch,
  Get,
  Param,
  Body,
  Req,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApprovalsService } from './approvals.service';
import {
  CreateApprovalRequestDto,
  DecideApprovalDto,
  ListApprovalsQueryDto,
} from './approvals.dto';

interface AuthRequest extends Request {
  user: { userId: string; email: string; role: string; sub?: string };
}

@ApiTags('approvals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvalsService: ApprovalsService) {}

  @Post()
  @ApiOperation({ summary: 'Create an approval request' })
  @ApiResponse({ status: 201, description: 'Approval request created' })
  @ApiResponse({ status: 409, description: 'Duplicate pending request' })
  create(@Req() req: AuthRequest, @Body() dto: CreateApprovalRequestDto) {
    return this.approvalsService.createRequest(req.user.userId, dto);
  }

  @Patch(':id/decide')
  @ApiOperation({ summary: 'Approve or reject an approval request' })
  @ApiResponse({ status: 200, description: 'Decision recorded' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  @ApiResponse({ status: 409, description: 'Request already decided' })
  decide(
    @Param('id') id: string,
    @Req() req: AuthRequest,
    @Body() dto: DecideApprovalDto,
  ) {
    return this.approvalsService.decide(id, req.user.userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List approval requests' })
  @ApiResponse({ status: 200, description: 'List of approval requests' })
  list(@Query() query: ListApprovalsQueryDto) {
    return this.approvalsService.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single approval request' })
  @ApiResponse({ status: 200, description: 'Approval request details' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  findOne(@Param('id') id: string) {
    return this.approvalsService.findOne(id);
  }
}
