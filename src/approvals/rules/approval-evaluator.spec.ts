import { evaluateApproval } from './approval-evaluator';
import type { ApprovalDecision, ApprovalRuleEntity } from './approval-rule.entity';

function makeRule(overrides: Partial<ApprovalRuleEntity> = {}): ApprovalRuleEntity {
  return {
    id: 'rule-1',
    requestType: 'adoption',
    requiredGroups: ['ADMIN'],
    quorum: 1,
    mode: 'PARALLEL',
    vetoOnReject: false,
    ...overrides,
  };
}

function grant(role = 'ADMIN', id = 'u1'): ApprovalDecision {
  return { deciderId: id, deciderRole: role, decision: 'GRANTED', decidedAt: new Date() };
}

function reject(role = 'ADMIN', id = 'u1'): ApprovalDecision {
  return { deciderId: id, deciderRole: role, decision: 'REJECTED', decidedAt: new Date() };
}

describe('evaluateApproval', () => {
  it('returns PENDING when no decisions have been made', () => {
    expect(evaluateApproval(makeRule(), [])).toBe('PENDING');
  });

  it('PARALLEL 2-of-3: completes on the second grant', () => {
    const rule = makeRule({ quorum: 2, requiredGroups: ['ADMIN', 'SHELTER', 'USER'] });
    expect(evaluateApproval(rule, [grant('ADMIN', 'u1')])).toBe('PENDING');
    expect(evaluateApproval(rule, [grant('ADMIN', 'u1'), grant('SHELTER', 'u2')])).toBe('GRANTED');
  });

  it('PARALLEL: returns REJECTED when quorum can no longer be reached', () => {
    // 2-of-3 quorum, but only 2 voters total — both reject → quorum unreachable
    const rule = makeRule({ quorum: 2, requiredGroups: ['ADMIN', 'SHELTER'] });
    const decisions = [reject('ADMIN', 'u1'), reject('SHELTER', 'u2')];
    expect(evaluateApproval(rule, decisions)).toBe('REJECTED');
  });

  it('vetoOnReject finalises immediately on first rejection', () => {
    const rule = makeRule({ vetoOnReject: true, quorum: 2 });
    expect(evaluateApproval(rule, [grant('ADMIN', 'u1'), reject('ADMIN', 'u2')])).toBe('REJECTED');
  });

  it('SEQUENTIAL: second group stays PENDING until first group grants', () => {
    const rule = makeRule({
      mode: 'SEQUENTIAL',
      requiredGroups: ['ADMIN', 'SHELTER'],
      quorum: 1,
    });
    expect(evaluateApproval(rule, [])).toBe('PENDING');
    expect(evaluateApproval(rule, [grant('SHELTER', 'u2')])).toBe('PENDING');
    expect(evaluateApproval(rule, [grant('ADMIN', 'u1')])).toBe('PENDING');
    expect(
      evaluateApproval(rule, [grant('ADMIN', 'u1'), grant('SHELTER', 'u2')]),
    ).toBe('GRANTED');
  });

  it('SEQUENTIAL: a rejection in any group returns REJECTED', () => {
    const rule = makeRule({ mode: 'SEQUENTIAL', requiredGroups: ['ADMIN', 'SHELTER'] });
    expect(evaluateApproval(rule, [reject('ADMIN', 'u1')])).toBe('REJECTED');
  });
});
