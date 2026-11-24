import type { ApprovalDecision, ApprovalRuleEntity } from './approval-rule.entity';

export type EvaluationResult = 'PENDING' | 'GRANTED' | 'REJECTED';

/**
 * Computes the aggregate approval status from a set of decisions and the rule.
 *
 * PARALLEL mode: once `quorum` grants are collected the result is GRANTED.
 * When enough rejections make the quorum unreachable the result is REJECTED.
 * SEQUENTIAL mode: each group in `requiredGroups` must supply at least one
 * grant before the next group is considered.
 * vetoOnReject: any rejection immediately finalises as REJECTED.
 */
export function evaluateApproval(
  rule: ApprovalRuleEntity,
  decisions: ApprovalDecision[],
): EvaluationResult {
  if (rule.vetoOnReject && decisions.some((d) => d.decision === 'REJECTED')) {
    return 'REJECTED';
  }

  if (rule.mode === 'PARALLEL') {
    const grants = decisions.filter((d) => d.decision === 'GRANTED').length;
    if (grants >= rule.quorum) return 'GRANTED';

    const rejections = decisions.filter((d) => d.decision === 'REJECTED').length;
    const totalDeciders = decisions.length;
    if (totalDeciders - rejections < rule.quorum) return 'REJECTED';

    return 'PENDING';
  }

  // SEQUENTIAL: each requiredGroup must have at least one grant before proceeding
  for (const group of rule.requiredGroups) {
    const groupDecisions = decisions.filter((d) => d.deciderRole === group);
    if (groupDecisions.length === 0) return 'PENDING';
    if (groupDecisions.some((d) => d.decision === 'REJECTED')) return 'REJECTED';
    if (!groupDecisions.some((d) => d.decision === 'GRANTED')) return 'PENDING';
  }

  return 'GRANTED';
}
