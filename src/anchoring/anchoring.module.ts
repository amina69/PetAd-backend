import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { LoggingModule } from '../logging/logging.module';
import { AnchorBatchRepository } from './anchor-batch.repository';
import { AnchoringService } from './anchoring.service';
import { AnchorConfirmationProcessor } from './anchor-confirmation.processor';
import { VerificationController } from './verification.controller';
import { ANCHOR_GATEWAY } from './gateways/anchor.gateway';
import { FakeAnchorGateway } from './gateways/fake-anchor.gateway';
import { HorizonAnchorGateway } from './gateways/horizon-anchor.gateway';

/**
 * Blockchain anchoring of the event ledger.
 *
 * The gateway is fake unless Stellar integration is enabled, so local and
 * CI runs can exercise the full flow without network access.
 */
@Global()
@Module({
  imports: [PrismaModule, LoggingModule, ConfigModule],
  controllers: [VerificationController],
  providers: [
    AnchorBatchRepository,
    AnchoringService,
    AnchorConfirmationProcessor,
    FakeAnchorGateway,
    HorizonAnchorGateway,
    {
      provide: ANCHOR_GATEWAY,
      useFactory: (
        configService: ConfigService,
        fakeGateway: FakeAnchorGateway,
        horizonGateway: HorizonAnchorGateway,
      ) =>
        configService.get<boolean>('stellar.enabled')
          ? horizonGateway
          : fakeGateway,
      inject: [ConfigService, FakeAnchorGateway, HorizonAnchorGateway],
    },
  ],
  exports: [
    AnchorBatchRepository,
    AnchoringService,
    AnchorConfirmationProcessor,
    ANCHOR_GATEWAY,
  ],
})
export class AnchoringModule {}
