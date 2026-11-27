import {
  Injectable,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventEntityType, EventType } from '@prisma/client';

export enum EscrowAction {
  RELEASE = 'RELEASE',
  REFUND = 'REFUND',
}

export interface SigningPolicy {
  action: EscrowAction;
  requiredApprovalTypes: string[];
  description: string;
}

export interface ApprovalRecord {
  id: string;
  entityId: string;
  eventType: EventType;
  actorId?: string | null;
  createdAt: Date;
  payload: unknown;
}

export interface SigningAuthorisation {
  approved: boolean;
  approvalIds: string[];
  action: EscrowAction;
}

const APPROVAL_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

const SIGNING_POLICIES: Record<EscrowAction, SigningPolicy> = {
  [EscrowAction.RELEASE]: {
    action: EscrowAction.RELEASE,
    requiredApprovalTypes: [
      EventType.ESCROW_FUNDED,
      EventType.ADOPTION_APPROVED,
    ],
    description:
      'Release requires platform-key signature plus one party approval (ESCROW_FUNDED + ADOPTION_APPROVED).',
  },
  [EscrowAction.REFUND]: {
    action: EscrowAction.REFUND,
    requiredApprovalTypes: [
      EventType.ESCROW_FUNDED,
      EventType.ADOPTION_CANCELLED,
    ],
    description:
      'Refund requires platform-key signature plus admin approval (ESCROW_FUNDED + ADOPTION_CANCELLED).',
  },
};

@Injectable()
export class SigningPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  getPolicy(action: EscrowAction): SigningPolicy {
    return SIGNING_POLICIES[action];
  }

  async authoriseAndSign(
    escrowId: string,
    action: EscrowAction,
  ): Promise<SigningAuthorisation> {
    const policy = this.getPolicy(action);

    const approvalRecords = await this.prisma.eventLog.findMany({
      where: {
        entityType: EventEntityType.ESCROW,
        entityId: escrowId,
        eventType: { in: policy.requiredApprovalTypes as EventType[] },
      },
      orderBy: { createdAt: 'desc' },
    });

    const foundTypes = new Set(approvalRecords.map((r) => r.eventType));
    const missingTypes = policy.requiredApprovalTypes.filter(
      (t) => !foundTypes.has(t as EventType),
    );

    if (missingTypes.length > 0) {
      throw new ForbiddenException(
        `Cannot ${action.toLowerCase()} escrow ${escrowId}: missing approval records for [${missingTypes.join(', ')}]. ` +
          policy.description,
      );
    }

    const now = Date.now();
    const staleRecords = approvalRecords.filter(
      (r) => now - r.createdAt.getTime() > APPROVAL_MAX_AGE_MS,
    );

    if (staleRecords.length > 0) {
      throw new BadRequestException(
        `Cannot ${action.toLowerCase()} escrow ${escrowId}: approval records [${staleRecords.map((r) => r.id).join(', ')}] have expired (older than 24 hours).`,
      );
    }

    const approvalIds = approvalRecords.map((r) => r.id);

    return {
      approved: true,
      approvalIds,
      action,
    };
  }

  buildSigningMetadata(
    authorisation: SigningAuthorisation,
  ): Record<string, unknown> {
    return {
      action: authorisation.action,
      authorisedByApprovalIds: authorisation.approvalIds,
      signedAt: new Date().toISOString(),
      policy: SIGNING_POLICIES[authorisation.action].description,
    };
  }
}
