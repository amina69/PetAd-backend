import { AbuseSignalType } from '@prisma/client';

export interface ReviewRecord {
  id: string;
  reviewerId: string;
  revieweeId: string;
  rating: number;
  createdAt: Date;
  deviceHash?: string | null;
  ipHash?: string | null;
}

export interface AgreementRecord {
  id: string;
  participantIds: [string, string];
  createdAt: Date;
}

export interface UserRecord {
  id: string;
  createdAt: Date;
}

export interface SharedSignalRecord {
  type: 'SHARED_DEVICE' | 'SHARED_IP';
  hashedValue: string;
  userIds: string[];
  reviewId?: string;
}

export interface ProposedAbuseSignal {
  type: AbuseSignalType;
  reviewId?: string;
  subjectUserId?: string;
  actorUserId?: string;
  counterpartyUserId?: string;
  hashedValue?: string;
  reason: string;
  severity: number;
  metadata?: Record<string, unknown>;
}

export interface AbuseThresholds {
  minAccountAgeDays: number;
  reviewBurstWindowDays: number;
  reviewBurstThreshold: number;
  agreementThreshold: number;
}

export interface AnalysisInput {
  reviews: ReviewRecord[];
  agreements: AgreementRecord[];
  users: UserRecord[];
  sharedSignals?: SharedSignalRecord[];
  now?: Date;
}
