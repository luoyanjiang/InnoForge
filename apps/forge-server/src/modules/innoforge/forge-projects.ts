import type { ForgeIntent } from './forge-loop.js';
import type { ForgeTask } from './forge-tasks.js';
import type { WorkbenchState } from './forge-workbench.js';

export const DEMO_PROJECT_SPECS = Object.freeze([
  {
    id: 'forge:studio-lightboat',
    statement: '轻舟项目 · 客户自助报价工具（工作室演示）',
    nameZh: '轻舟项目',
    nameEn: 'Lightboat',
  },
  {
    id: 'forge:studio-hoshino',
    statement: '星野站点改版 · 验证委托（演示）',
    nameZh: '星野站点',
    nameEn: 'Hoshino site',
  },
] as const);

export type ForgeProjectDto = Readonly<{
  id: string;
  name: string;
  statement: string;
  scenario: string;
  status: string;
  updatedAt: string;
  hasWorkbench: boolean;
}>;

export type ForgeMyTaskDto = Readonly<{
  task: ForgeTask;
  projectId: string;
  projectName: string;
}>;

export function projectDisplayName(
  intent: ForgeIntent,
  workbench?: WorkbenchState | null,
  locale: 'zh' | 'en' = 'zh',
): string {
  const lockedTitle = workbench?.locked?.title?.trim();
  if (lockedTitle) return lockedTitle;
  const reqTitle = workbench?.req?.title?.trim();
  if (reqTitle && workbench?.accepted) return reqTitle;
  const spec = DEMO_PROJECT_SPECS.find((s) => s.id === intent.id);
  if (spec) return locale === 'en' ? spec.nameEn : spec.nameZh;
  const statement = intent.statement.trim();
  if (statement) {
    const cut = statement.split(/[·|—–-]/)[0]?.trim() || statement;
    return cut.slice(0, 40);
  }
  return intent.id;
}

export function toProjectDto(input: {
  intent: ForgeIntent;
  workbench?: WorkbenchState | null;
  locale?: 'zh' | 'en';
}): ForgeProjectDto {
  const locale = input.locale ?? 'zh';
  return Object.freeze({
    id: input.intent.id,
    name: projectDisplayName(input.intent, input.workbench, locale),
    statement: input.intent.statement,
    scenario: input.intent.scenario || 'PRODUCT',
    status: input.intent.status,
    updatedAt: input.intent.updatedAt,
    hasWorkbench: !!input.workbench,
  });
}
