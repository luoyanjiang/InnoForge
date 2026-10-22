export type ForgeLocale = 'zh' | 'en';

const messages = {
  zh: {
    brand: 'InnoForge',
    title: '意图闭环控制台',
    subtitle: '在 PXN 执行保障层上：意图 → 确认 → 受控部署 → 反馈',
    createIntent: '创建意图',
    intentStatement: '意图陈述',
    stakeAmount: 'Credit 质押',
    confirm: '人类确认',
    deploy: '受控部署',
    feedback: '推进反馈',
    adapters: '外部适配器',
    creditBalance: 'Credit 余额',
    status: '状态',
    language: '语言',
    runLoop: '运行闭环切片',
    placeholder: '例如：小批量结构件打样并回传质检',
    success: '闭环完成，Credit 已按模拟规则兑现',
    needsConfirm: '等待人类确认后才能进入物理部署',
    modeSim: '模拟',
  },
  en: {
    brand: 'InnoForge',
    title: 'Intent loop console',
    subtitle: 'On PXN execution assurance: intent → confirm → governed deploy → feedback',
    createIntent: 'Create intent',
    intentStatement: 'Intent statement',
    stakeAmount: 'Credit stake',
    confirm: 'Human confirm',
    deploy: 'Governed deploy',
    feedback: 'Advance feedback',
    adapters: 'External adapters',
    creditBalance: 'Credit balance',
    status: 'Status',
    language: 'Language',
    runLoop: 'Run loop slice',
    placeholder: 'e.g. small-batch structural prototype with QC feedback',
    success: 'Loop complete; Credit settled under simulator rules',
    needsConfirm: 'Human confirm required before physical deploy',
    modeSim: 'Simulator',
  },
} as const;

export type ForgeMessageKey = keyof typeof messages.zh;

export function forgeMessages(locale: ForgeLocale): Readonly<Record<ForgeMessageKey, string>> {
  return messages[locale] ?? messages.zh;
}

export function resolveLocale(raw: string | undefined): ForgeLocale {
  if (!raw) return 'zh';
  const normalized = raw.toLowerCase();
  if (normalized.startsWith('en')) return 'en';
  return 'zh';
}
