import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MessagingService } from './messaging.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { ListMessagesQueryDto, SendMessageDto } from './dto/send-message.dto';
import { ReadReceiptDto, ReportConversationDto } from './dto/read-receipt.dto';

interface AuthRequest extends Request {
  user?: {
    userId?: string;
    sub?: string;
    role?: string;
  };
}

@ApiTags('Messaging')
@ApiBearerAuth('JWT-auth')
@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class MessagingController {
  constructor(private readonly messagingService: MessagingService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @ApiOperation({
    summary: 'Create (or reuse) a conversation',
    description:
      'One conversation exists per pet and pair of participants. Repeating ' +
      'the same request returns the same conversation id. Requires a verified email.',
  })
  @ApiResponse({ status: 201, description: 'Conversation created or reused' })
  @ApiResponse({ status: 403, description: 'EMAIL_NOT_VERIFIED' })
  @ApiResponse({ status: 404, description: 'Pet or participant not found' })
  createConversation(
    @Body() dto: CreateConversationDto,
    @Req() req: AuthRequest,
  ) {
    return this.messagingService.createConversation(this.userId(req), dto);
  }

  @Get()
  @ApiOperation({ summary: 'List my conversations' })
  listConversations(@Req() req: AuthRequest) {
    return this.messagingService.listConversations(this.userId(req));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one conversation (participants only)' })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
  getConversation(@Param('id') id: string, @Req() req: AuthRequest) {
    return this.messagingService.getConversation(id, this.userId(req));
  }

  @Get(':id/messages')
  @ApiOperation({
    summary: 'List messages (newest first, cursor paginated)',
    description:
      'Pass the previous page `nextCursor` as `cursor` to fetch older messages.',
  })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
  listMessages(
    @Param('id') id: string,
    @Query() query: ListMessagesQueryDto,
    @Req() req: AuthRequest,
  ) {
    return this.messagingService.listMessages(id, this.userId(req), query);
  }

  @Post(':id/messages')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @ApiOperation({
    summary: 'Send a message',
    description:
      'Body is plain text (1-2000 characters) with up to 3 attachment ' +
      'document ids. Rate limited to 30 messages per minute.',
  })
  @ApiResponse({ status: 201, description: 'Message envelope' })
  @ApiResponse({
    status: 400,
    description: 'Invalid body, cursor or attachments',
  })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  sendMessage(
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
    @Req() req: AuthRequest,
  ) {
    return this.messagingService.sendMessage(id, this.userId(req), dto);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set the read position for this conversation' })
  markRead(
    @Param('id') id: string,
    @Body() dto: ReadReceiptDto,
    @Req() req: AuthRequest,
  ) {
    return this.messagingService.markRead(id, this.userId(req), dto);
  }

  @Post(':id/report')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({
    summary: 'Report a conversation for moderation',
    description:
      'Stores an immutable evidence snapshot of the last 50 messages.',
  })
  reportConversation(
    @Param('id') id: string,
    @Body() dto: ReportConversationDto,
    @Req() req: AuthRequest,
  ) {
    return this.messagingService.reportConversation(id, this.userId(req), dto);
  }

  private userId(req: AuthRequest): string {
    const id = req.user?.userId ?? req.user?.sub;
    if (!id) {
      throw new UnauthorizedException();
    }
    return id;
  }
}
