import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeTicketService } from './realtime-ticket.service';
import { RealtimeTicketController } from './realtime-ticket.controller';
import { WsAuthGuard } from './ws-auth.guard';
import { REALTIME_PUBLISHER } from './realtime.publisher';

@Module({
  controllers: [RealtimeTicketController],
  providers: [
    RealtimeTicketService,
    WsAuthGuard,
    RealtimeGateway,
    {
      provide: REALTIME_PUBLISHER,
      useExisting: RealtimeGateway,
    },
  ],
  exports: [RealtimeGateway, RealtimeTicketService, REALTIME_PUBLISHER],
})
export class RealtimeModule {}
