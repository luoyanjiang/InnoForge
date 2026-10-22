import { createHash } from 'node:crypto';

import { immutableJsonCopy } from '../../../../../packages/domain/src/canonical-json.js';
import { ForgeLoopError } from './forge-loop.js';

export type ForgeJudgmentAction = 'ADOPT' | 'REJECT';

export type ForgeVariantCandidate = Readonly<{
  id: string;
  tag: string;
  titleZh: string;
  titleEn: string;
  bodyZh: string;
  bodyEn: string;
  impact: 'high' | 'med' | 'explore';
}>;

export type ForgeJudgment = Readonly<{
  id: string;
  intentId: string;
  tenantId: string;
  actorId: string;
  candidateId: string;
  action: ForgeJudgmentAction;
  rationale?: string;
  impact?: string;
  candidateSnapshot: ForgeVariantCandidate;
  occurredAt: string;
}>;

/** MVP intent-level static Agent candidates (same catalog for every intent). */
export const DEFAULT_VARIANT_CANDIDATES: readonly ForgeVariantCandidate[] = Object.freeze([
  Object.freeze({
    id: 'v1',
    tag: 'AI · Cost',
    titleZh: '点阵加强肋',
    titleEn: 'Lattice reinforcing ribs',
    bodyZh: '丝材节省约 18%',
    bodyEn: '~18% filament savings',
    impact: 'high' as const,
  }),
  Object.freeze({
    id: 'v2',
    tag: 'AI · Experience',
    titleZh: '卡扣模块',
    titleEn: 'Snap-fit module',
    bodyZh: '面向现场维护',
    bodyEn: 'Field maintenance focus',
    impact: 'med' as const,
  }),
  Object.freeze({
    id: 'v3',
    tag: 'AI · Sustainability',
    titleZh: '再生 PETG 外壳',
    titleEn: 'Recycled PETG casing',
    bodyZh: '循环记录友好',
    bodyEn: 'Circular-record friendly',
    impact: 'explore' as const,
  }),
]);

export function listDefaultCandidates(): readonly ForgeVariantCandidate[] {
  return DEFAULT_VARIANT_CANDIDATES;
}

export function findCandidate(candidateId: string): ForgeVariantCandidate {
  const found = DEFAULT_VARIANT_CANDIDATES.find((item) => item.id === candidateId);
  if (!found) throw new ForgeLoopError('CANDIDATE_NOT_FOUND');
  return found;
}

export function judgmentIdFor(intentId: string, candidateId: string): string {
  return `fjdg:${createHash('sha256').update(`${intentId}:${candidateId}`).digest('hex').slice(0, 24)}`;
}

export function normalizeJudgmentAction(raw: unknown): ForgeJudgmentAction {
  if (raw === 'ADOPT' || raw === 'REJECT') return raw;
  throw new ForgeLoopError('JUDGMENT_ACTION_INVALID');
}

export function freezeJudgment(input: ForgeJudgment): ForgeJudgment {
  return immutableJsonCopy(input);
}
