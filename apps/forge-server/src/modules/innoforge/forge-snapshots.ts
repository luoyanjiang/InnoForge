import { createHash } from 'node:crypto';

import { immutableJsonCopy } from '../../../../../packages/domain/src/canonical-json.js';
import type { ForgeConstraint } from './forge-constraints.js';
import type { ForgeJudgment } from './forge-judgments.js';

export type ForgeSnapshotJudgmentSummary = Readonly<{
  id: string;
  candidateId: string;
  action: string;
  actorId: string;
}>;

export type ForgeSnapshot = Readonly<{
  id: string;
  intentId: string;
  tenantId: string;
  statement: string;
  constraints: readonly ForgeConstraint[];
  frozen: boolean;
  judgmentsSummary: readonly ForgeSnapshotJudgmentSummary[];
  contentHash: string;
  pxnTaskId?: string;
  createdAt: string;
  createdBy: string;
}>;

export function snapshotIdFor(intentId: string, contentHash: string, at: string): string {
  return `fsnap:${createHash('sha256').update(`${intentId}:${contentHash}:${at}`).digest('hex').slice(0, 24)}`;
}

export function summarizeJudgments(
  judgments: readonly ForgeJudgment[],
): readonly ForgeSnapshotJudgmentSummary[] {
  return Object.freeze(
    judgments.map((item) => Object.freeze({
      id: item.id,
      candidateId: item.candidateId,
      action: item.action,
      actorId: item.actorId,
    })),
  );
}

export function hashSnapshotContent(input: {
  statement: string;
  constraints: readonly ForgeConstraint[];
  frozen: boolean;
  judgmentsSummary: readonly ForgeSnapshotJudgmentSummary[];
}): string {
  const canonical = JSON.stringify({
    statement: input.statement,
    constraints: input.constraints,
    frozen: input.frozen,
    judgments: input.judgmentsSummary,
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

export function freezeSnapshot(input: ForgeSnapshot): ForgeSnapshot {
  return Object.freeze({
    ...input,
    constraints: Object.freeze(input.constraints.map((c) => immutableJsonCopy(c))),
    judgmentsSummary: Object.freeze([...input.judgmentsSummary]),
  });
}
