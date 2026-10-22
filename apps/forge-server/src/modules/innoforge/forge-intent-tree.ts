import { createHash, randomUUID } from 'node:crypto';

import { immutableJsonCopy } from '../../../../../packages/domain/src/canonical-json.js';
import type { ForgeConstraint } from './forge-constraints.js';

export type ForgeScenario = 'PRODUCT' | 'RESEARCH' | 'HARDWARE';
export type ForgeCollabStage = 'DRAFT' | 'EXPLORING' | 'VALIDATING' | 'COMMITTED';
export type ForgeTreeNodeKind = 'GOAL' | 'CONSTRAINT' | 'SUCCESS' | 'BRANCH';
export type ForgeTreeNodeStatus = 'OPEN' | 'ALIGNED' | 'CONFLICT' | 'DONE';

export type ForgeTreeNode = Readonly<{
  id: string;
  parentId: string | null;
  kind: ForgeTreeNodeKind;
  title: string;
  status: ForgeTreeNodeStatus;
}>;

export type ForgeIntentTree = Readonly<{
  nodes: readonly ForgeTreeNode[];
  updatedAt: string;
}>;

export const COLLAB_STAGE_ORDER: readonly ForgeCollabStage[] = Object.freeze([
  'DRAFT',
  'EXPLORING',
  'VALIDATING',
  'COMMITTED',
]);

export const SCENARIOS: readonly ForgeScenario[] = Object.freeze([
  'PRODUCT',
  'RESEARCH',
  'HARDWARE',
]);

export function newTreeNodeId(): string {
  return `ftn:${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

export function rootGoalId(intentId: string): string {
  return `ftn:${createHash('sha256').update(`goal:${intentId}`).digest('hex').slice(0, 24)}`;
}

export function freezeTreeNode(input: ForgeTreeNode): ForgeTreeNode {
  return Object.freeze(immutableJsonCopy(input));
}

export function freezeIntentTree(input: ForgeIntentTree): ForgeIntentTree {
  return Object.freeze({
    nodes: Object.freeze(input.nodes.map((n) => freezeTreeNode(n))),
    updatedAt: input.updatedAt,
  });
}

export function normalizeScenario(raw: unknown): ForgeScenario {
  if (raw === 'RESEARCH' || raw === 'HARDWARE' || raw === 'PRODUCT') return raw;
  return 'PRODUCT';
}

export function normalizeCollabStage(raw: unknown): ForgeCollabStage {
  if (
    raw === 'DRAFT'
    || raw === 'EXPLORING'
    || raw === 'VALIDATING'
    || raw === 'COMMITTED'
  ) {
    return raw;
  }
  return 'DRAFT';
}

export function canAdvanceCollabStage(
  from: ForgeCollabStage,
  to: ForgeCollabStage,
): boolean {
  const a = COLLAB_STAGE_ORDER.indexOf(from);
  const b = COLLAB_STAGE_ORDER.indexOf(to);
  return b === a + 1;
}

export function seedIntentTree(input: {
  intentId: string;
  statement: string;
  constraints: readonly ForgeConstraint[];
  at: string;
}): ForgeIntentTree {
  const rootId = rootGoalId(input.intentId);
  const nodes: ForgeTreeNode[] = [
    freezeTreeNode({
      id: rootId,
      parentId: null,
      kind: 'GOAL',
      title: input.statement.trim().slice(0, 120) || input.intentId,
      status: 'OPEN',
    }),
  ];
  for (const c of input.constraints) {
    const title = c.unit
      ? `${c.key} ${c.op} ${c.value} ${c.unit}`
      : `${c.key} ${c.op} ${c.value}`;
    nodes.push(freezeTreeNode({
      id: newTreeNodeId(),
      parentId: rootId,
      kind: 'CONSTRAINT',
      title,
      status: 'OPEN',
    }));
  }
  nodes.push(freezeTreeNode({
    id: newTreeNodeId(),
    parentId: rootId,
    kind: 'SUCCESS',
    title: 'Define measurable success criteria',
    status: 'OPEN',
  }));
  return freezeIntentTree({ nodes, updatedAt: input.at });
}

export function normalizeIntentTree(raw: unknown, at: string): ForgeIntentTree {
  if (!raw || typeof raw !== 'object') {
    return freezeIntentTree({ nodes: [], updatedAt: at });
  }
  const body = raw as Record<string, unknown>;
  const list = Array.isArray(body.nodes) ? body.nodes : [];
  const nodes: ForgeTreeNode[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id : newTreeNodeId();
    const parentId = row.parentId == null
      ? null
      : (typeof row.parentId === 'string' ? row.parentId : null);
    const kind = row.kind === 'CONSTRAINT'
      || row.kind === 'SUCCESS'
      || row.kind === 'BRANCH'
      || row.kind === 'GOAL'
      ? row.kind
      : 'BRANCH';
    const title = typeof row.title === 'string' ? row.title.trim() : '';
    if (!title) continue;
    const status = row.status === 'ALIGNED'
      || row.status === 'CONFLICT'
      || row.status === 'DONE'
      || row.status === 'OPEN'
      ? row.status
      : 'OPEN';
    nodes.push(freezeTreeNode({ id, parentId, kind, title, status }));
  }
  return freezeIntentTree({
    nodes,
    updatedAt: typeof body.updatedAt === 'string' ? body.updatedAt : at,
  });
}
