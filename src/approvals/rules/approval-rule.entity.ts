export interface ApprovalDecision {
  deciderId: string;
  deciderRole: string;
  decision: 'GRANTED' | 'REJECTED';
  decidedAt: Date;
}

export interface ApprovalRuleEntity {
  id: string;
  requestType: string;
  requiredGroups: string[];
  quorum: number;
  mode: 'SEQUENTIAL' | 'PARALLEL';
  vetoOnReject: boolean;
}
