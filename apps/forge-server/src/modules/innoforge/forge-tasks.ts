import { randomUUID } from 'node:crypto';

import { immutableJsonCopy } from '../../../../../packages/domain/src/canonical-json.js';

export type ForgeTaskExecutor = 'AI' | 'HUMAN';
export type ForgeTaskStatus =
  | 'PENDING'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'REVIEW'
  | 'DONE'
  | 'FAILED';

export type ForgeTask = Readonly<{
  id: string;
  intentId: string;
  tenantId: string;
  treeNodeId?: string;
  title: string;
  executor: ForgeTaskExecutor;
  status: ForgeTaskStatus;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}>;

export const TASK_STATUS_ORDER: readonly ForgeTaskStatus[] = Object.freeze([
  'PENDING',
  'ASSIGNED',
  'IN_PROGRESS',
  'REVIEW',
  'DONE',
]);

export function newTaskId(): string {
  return `ftask:${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

export function freezeTask(input: ForgeTask): ForgeTask {
  return Object.freeze(immutableJsonCopy(input));
}

export function normalizeExecutor(raw: unknown): ForgeTaskExecutor {
  return raw === 'HUMAN' ? 'HUMAN' : 'AI';
}

export function normalizeTaskStatus(raw: unknown): ForgeTaskStatus {
  if (
    raw === 'PENDING'
    || raw === 'ASSIGNED'
    || raw === 'IN_PROGRESS'
    || raw === 'REVIEW'
    || raw === 'DONE'
    || raw === 'FAILED'
  ) {
    return raw;
  }
  return 'PENDING';
}

export function canAdvanceTaskStatus(
  from: ForgeTaskStatus,
  to: ForgeTaskStatus,
): boolean {
  if (to === 'FAILED') return from !== 'DONE' && from !== 'FAILED';
  if (from === 'FAILED' || from === 'DONE') return false;
  const a = TASK_STATUS_ORDER.indexOf(from);
  const b = TASK_STATUS_ORDER.indexOf(to);
  return b === a + 1;
}

/** Scenario-aware starter task titles (sim; no LLM). */
export function seedTaskTitles(scenario: string): readonly string[] {
  if (scenario === 'RESEARCH') {
    return Object.freeze([
      'Literature gap scan',
      'Hypothesis falsifiability check',
      'Experiment design draft',
    ]);
  }
  if (scenario === 'HARDWARE') {
    return Object.freeze([
      'Constraint pack freeze',
      'Structural sim batch',
      'DFM / BOM estimate',
    ]);
  }
  return Object.freeze([
    'User problem framing',
    'Interactive prototype pass',
    'Growth metric definition',
  ]);
}

/** Plugin entry hints only — not real FreeCAD / OpenFOAM / lit-DB wiring. */
export function scenarioPluginHints(scenario: string): Readonly<{
  id: string;
  labelZh: string;
  labelEn: string;
  hintZh: string;
  hintEn: string;
}> {
  if (scenario === 'RESEARCH') {
    return Object.freeze({
      id: 'lit-hypothesis',
      labelZh: '文献 · 假设',
      labelEn: 'Literature · Hypothesis',
      hintZh: '插件入口（模拟）：文献检索与假设可证伪性检查 — 未接真实文献库。',
      hintEn: 'Plugin entry (sim): lit search + falsifiability — no real literature DB.',
    });
  }
  if (scenario === 'HARDWARE') {
    return Object.freeze({
      id: 'sim-orchestrate',
      labelZh: '仿真编排',
      labelEn: 'Sim orchestration',
      hintZh: '插件入口（模拟）：结构/流体仿真编排 — 未接 FreeCAD / OpenFOAM。',
      hintEn: 'Plugin entry (sim): structural/fluid orchestration — FreeCAD/OpenFOAM not wired.',
    });
  }
  return Object.freeze({
    id: 'product-prototype',
    labelZh: '产品原型',
    labelEn: 'Product prototype',
    hintZh: '插件入口（模拟）：交互原型与增长指标 — 未接真实设计工具链。',
    hintEn: 'Plugin entry (sim): interactive prototype + growth metrics — no design toolchain.',
  });
}

export type ForgeSpaceAsset = Readonly<{
  id: string;
  title: string;
  kind: string;
  updatedAt: string;
}>;

export type ForgeSpacesView = Readonly<{
  personal: readonly ForgeSpaceAsset[];
  team: readonly ForgeSpaceAsset[];
  project: readonly ForgeSpaceAsset[];
  note: string;
}>;

/** Sim asset columns — no object store / graph DB. */
export function simSpacesView(input: {
  tenantId: string;
  locale?: string;
  at?: string;
}): ForgeSpacesView {
  const at = input.at || new Date().toISOString();
  const zh = input.locale !== 'en';
  return Object.freeze({
    personal: Object.freeze([
      Object.freeze({
        id: `sp:personal:${input.tenantId}:draft`,
        title: zh ? '个人草稿包' : 'Personal draft pack',
        kind: 'DRAFT',
        updatedAt: at,
      }),
      Object.freeze({
        id: `sp:personal:${input.tenantId}:notes`,
        title: zh ? 'Lumen 笔记切片' : 'Lumen note slices',
        kind: 'MEMORY',
        updatedAt: at,
      }),
    ]),
    team: Object.freeze([
      Object.freeze({
        id: `sp:team:${input.tenantId}:shared`,
        title: zh ? '团队共享组件' : 'Team shared components',
        kind: 'COMPONENT',
        updatedAt: at,
      }),
    ]),
    project: Object.freeze([
      Object.freeze({
        id: `sp:project:${input.tenantId}:intent`,
        title: zh ? '项目意图资产（模拟）' : 'Project intent assets (sim)',
        kind: 'INTENT',
        updatedAt: at,
      }),
      Object.freeze({
        id: `sp:project:${input.tenantId}:deploy`,
        title: zh ? '最近部署产物（占位）' : 'Recent deploy artifacts (placeholder)',
        kind: 'DEPLOY',
        updatedAt: at,
      }),
    ]),
    note: zh
      ? '模拟数据：无对象存储 / 图谱库；沉淀仅写本地事件提示。'
      : 'Sim data: no object store / graph DB; deposit is a local event toast only.',
  });
}
