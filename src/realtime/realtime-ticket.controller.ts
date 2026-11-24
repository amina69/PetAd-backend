import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { RealtimeTicketService } from './realtime-ticket.service';

@ApiTags('Realtime')
@ApiBearerAuth('JWT-auth')
@Controller('realtime')
@UseGuards(JwtAuthGuard)
export class RealtimeTicketController {
  constructor(private readonly tickets: RealtimeTicketService) {}

  @Post('ticket')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Issue a realtime connection ticket',
    description:
      'Returns a single-use ticket valid for 30 seconds. Pass it to the ' +
      'socket.io client as `auth: { ticket }` — never put the JWT in the URL.',
  })
  @ApiResponse({
    status: 200,
    description: 'Ticket issued',
    schema: {
      example: {
        ticket: '8Zc0...opaque...',
        expiresAt: '2026-11-24T12:00:30.000Z',
      },
    },
  })
  async issueTicket(@CurrentUser() user: CurrentUserPayload) {
    return this.tickets.issue(user.userId);
  }
}
