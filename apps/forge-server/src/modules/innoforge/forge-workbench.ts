import { immutableJsonCopy } from '../../../../../packages/domain/src/canonical-json.js';

export const WORKBENCH_DEMO_INTENT_ID = 'forge:studio-lightboat';
export const WORKBENCH_SCHEMA = 6;
export const WORKBENCH_CONTRACT_FEE = 600;
export const WORKBENCH_BUILD_RESERVE = 120;
export const WORKBENCH_BUILD_SPEND = 96;

export type WorkbenchStage = 'brief' | 'craft' | 'check' | 'deliver';
export type WorkbenchRole = 'maker' | 'client';
export type WorkbenchPayableStatus = 'COMMITTED' | 'PAYABLE' | 'unpaid';

export type WorkbenchRule = Readonly<{
  title?: string;
  price: number;
  threshold: number;
  rate: number;
}>;

export type WorkbenchReq = Readonly<{
  title: string;
  price: number;
  threshold: number;
  rate: number;
}>;

export type WorkbenchQuote = Readonly<{ base: number; fee: number; total: number }>;

export type WorkbenchCaseResult = Readonly<{
  id: string;
  pages: number;
  days: number;
  expected: number;
  actual: number | null;
  pass: boolean;
  z?: string;
  e?: string;
}>;

export type WorkbenchState = {
  schema: number;
  lang: 'zh' | 'en';
  stage: WorkbenchStage;
  role: WorkbenchRole;
  panel: string;
  accepted: boolean;
  built: boolean;
  busy: boolean;
  buildTick: number;
  req: WorkbenchReq;
  locked: WorkbenchReq | null;
  rule: WorkbenchRule | null;
  version: number;
  versions: Array<{
    version: number;
    rule: WorkbenchRule;
    at: string;
    type: string;
    previous?: WorkbenchRule;
    comment?: string | null;
  }>;
  tests: {
    version: number;
    requirements: string;
    results: WorkbenchCaseResult[];
    at: string;
  } | null;
  checks: unknown[];
  comment: {
    id: string;
    text: string;
    anchor: string;
    version: number;
    inputs: { pages: number; days: number };
    snapshot: WorkbenchQuote;
    status: 'open' | 'recheck' | 'resolved';
    at: string;
    environment: string;
    from: string;
    response?: string;
    respondedAt?: string;
    resolvedVersion?: number;
    resolvedAt?: string;
  } | null;
  submitted: Record<string, unknown> | null;
  submissions: unknown[];
  acceptedDelivery: Record<string, unknown> | null;
  payable: {
    id: string;
    contract: string;
    milestone: string;
    amount: number;
    paid: number;
    status: WorkbenchPayableStatus;
    createdAt: string;
    dueAt: string;
    version: number;
    environment: string;
  } | null;
  pages: number;
  days: number;
  selectedCase: string;
  budget: { total: number; spent: number; reserved: number };
  contract: {
    id: string;
    task: string;
    project: string;
    amount: number;
    acceptedAt: string;
    requirements: WorkbenchReq;
    paymentDays: number;
    environment: string;
  } | null;
  asset: Record<string, unknown> | null;
  toast: string;
  history: Array<{ z: string; e: string; at: string; version: number; mode?: string }>;
  feedbackHistory: unknown[];
  testRunning: boolean;
  demo: boolean;
  taskId?: string;
  previewVersion?: number;
};

export function freshWorkbenchState(lang: 'zh' | 'en' = 'zh'): WorkbenchState {
  return {
    schema: WORKBENCH_SCHEMA,
    lang,
    stage: 'brief',
    role: 'maker',
    panel: 'default',
    accepted: false,
    built: false,
    busy: false,
    buildTick: 0,
    req: { title: '轻舟报价器', price: 800, threshold: 7, rate: 30 },
    locked: null,
    rule: null,
    version: 0,
    versions: [],
    tests: null,
    checks: [],
    comment: null,
    submitted: null,
    submissions: [],
    acceptedDelivery: null,
    payable: null,
    pages: 3,
    days: 10,
    selectedCase: 'normal',
    budget: { total: 1200, spent: 0, reserved: 0 },
    contract: null,
    asset: null,
    toast: '',
    history: [],
    feedbackHistory: [],
    testRunning: false,
    demo: true,
  };
}

export function freezeWorkbenchState(state: WorkbenchState): WorkbenchState {
  return Object.freeze(immutableJsonCopy(state)) as WorkbenchState;
}

/** Mutable deep clone for transitions (immutableJsonCopy freezes). */
export function cloneWorkbenchState(state: WorkbenchState): WorkbenchState {
  return JSON.parse(JSON.stringify(state)) as WorkbenchState;
}

export function calcQuote(
  rule: Pick<WorkbenchRule, 'price' | 'threshold' | 'rate'> | null | undefined,
  pages: number,
  days: number,
): WorkbenchQuote | null {
  if (
    !rule
    || !Number.isInteger(pages)
    || pages < 1
    || pages > 30
    || !Number.isInteger(days)
    || days < 1
    || days > 60
  ) {
    return null;
  }
  const base = pages * rule.price;
  const fee = days < rule.threshold ? Math.round((base * rule.rate) / 100) : 0;
  return { base, fee, total: base + fee };
}

export function acceptanceCases(locked: WorkbenchReq): ReadonlyArray<{
  id: string;
  z: string;
  e: string;
  pages: number;
  days: number;
  expected: number;
}> {
  return Object.freeze([
    {
      id: 'normal',
      z: '常规交付',
      e: 'Standard',
      pages: 3,
      days: locked.threshold + 3,
      expected: 3 * locked.price,
    },
    {
      id: 'rush',
      z: '加急边界前一天',
      e: 'One day below cutoff',
      pages: 3,
      days: locked.threshold - 1,
      expected: 3 * locked.price + Math.round((3 * locked.price * locked.rate) / 100),
    },
    {
      id: 'edge',
      z: '恰好到达边界',
      e: 'Exactly at the cutoff',
      pages: 3,
      days: locked.threshold,
      expected: 3 * locked.price,
    },
  ]);
}

export function validBriefRule(r: WorkbenchReq): boolean {
  return (
    Number.isInteger(r.price)
    && r.price >= 100
    && r.price <= 10000
    && Number.isInteger(r.threshold)
    && r.threshold >= 3
    && r.threshold <= 25
    && Number.isInteger(r.rate)
    && r.rate >= 1
    && r.rate <= 100
  );
}

export function validEditRule(r: WorkbenchRule): boolean {
  return (
    Number.isInteger(r.price)
    && r.price >= 100
    && r.price <= 10000
    && Number.isInteger(r.threshold)
    && r.threshold >= 1
    && r.threshold <= 50
    && Number.isInteger(r.rate)
    && r.rate >= 1
    && r.rate <= 100
  );
}

export function obligation(state: WorkbenchState): number {
  return state.contract ? WORKBENCH_CONTRACT_FEE : 0;
}

export function availableBudget(state: WorkbenchState): number {
  return state.budget.total - state.budget.spent - state.budget.reserved - obligation(state);
}

export function ruleMatchesRequirements(
  state: WorkbenchState,
  rule: WorkbenchRule | null = state.rule,
): boolean {
  return !!rule
    && !!state.locked
    && rule.price === state.locked.price
    && rule.threshold === state.locked.threshold
    && rule.rate === state.locked.rate;
}

export function testReady(state: WorkbenchState): boolean {
  return !!state.tests
    && state.tests.version === state.version
    && state.tests.results.every((x) => x.pass);
}

export function feedbackReady(state: WorkbenchState): boolean {
  return !state.comment || state.comment.status === 'resolved';
}

export function canSubmit(state: WorkbenchState): boolean {
  return state.role === 'maker'
    && state.built
    && !state.submitted
    && !state.acceptedDelivery
    && testReady(state)
    && feedbackReady(state)
    && ruleMatchesRequirements(state);
}

function pushHistory(
  state: WorkbenchState,
  z: string,
  e: string,
  at: string,
  extra: Record<string, unknown> = {},
): void {
  state.history.push({ z, e, at, version: state.version, ...extra });
}

export function applyAcceptContract(
  state: WorkbenchState,
  at: string,
): WorkbenchState {
  const next = cloneWorkbenchState(state);
  if (next.accepted) throw Object.assign(new Error('WORKBENCH_ALREADY_ACCEPTED'), { code: 'WORKBENCH_ALREADY_ACCEPTED' });
  const r = next.req;
  if (!r.title.trim() || r.title.length > 30 || !validBriefRule(r)) {
    throw Object.assign(new Error('WORKBENCH_BRIEF_INVALID'), { code: 'WORKBENCH_BRIEF_INVALID' });
  }
  if (availableBudget(next) < WORKBENCH_CONTRACT_FEE) {
    throw Object.assign(new Error('WORKBENCH_BUDGET_INSUFFICIENT'), { code: 'WORKBENCH_BUDGET_INSUFFICIENT' });
  }
  next.locked = { ...r, title: r.title.trim() };
  next.accepted = true;
  next.contract = {
    id: 'C-01',
    task: 'T-01',
    project: 'Lightboat',
    amount: WORKBENCH_CONTRACT_FEE,
    acceptedAt: at,
    requirements: { ...next.locked },
    paymentDays: 7,
    environment: 'local-demo',
  };
  next.stage = 'craft';
  next.panel = 'default';
  pushHistory(next, '接下制作委托，固定报酬 ¥600', 'Accepted the job, fixed fee ¥600', at);
  next.toast = '';
  return next;
}

export function applyBuild(
  state: WorkbenchState,
  action: 'start' | 'tick' | 'complete' | 'pause' | 'run',
  at: string,
): WorkbenchState {
  const next = cloneWorkbenchState(state);
  if (!next.accepted || next.built) {
    throw Object.assign(new Error('WORKBENCH_BUILD_INVALID'), { code: 'WORKBENCH_BUILD_INVALID' });
  }
  if (action === 'pause') {
    if (!next.busy) {
      throw Object.assign(new Error('WORKBENCH_NOT_BUSY'), { code: 'WORKBENCH_NOT_BUSY' });
    }
    next.busy = false;
    next.budget.reserved = 0;
    next.buildTick = 0;
    pushHistory(next, '暂停制作，释放预留 ¥120', 'Paused the build, released ¥120', at, { mode: 'SIM' });
    return next;
  }
  if (action === 'start') {
    if (next.busy) {
      throw Object.assign(new Error('WORKBENCH_ALREADY_BUSY'), { code: 'WORKBENCH_ALREADY_BUSY' });
    }
    if (availableBudget(next) < WORKBENCH_BUILD_RESERVE) {
      throw Object.assign(new Error('WORKBENCH_BUDGET_INSUFFICIENT'), { code: 'WORKBENCH_BUDGET_INSUFFICIENT' });
    }
    next.busy = true;
    next.buildTick = 0;
    next.budget.reserved = WORKBENCH_BUILD_RESERVE;
    next.panel = 'default';
    pushHistory(next, '授权模板制作，上限 ¥120', 'Authorized template build, limit ¥120', at, { mode: 'SIM' });
    return next;
  }
  if (action === 'tick') {
    if (!next.busy) {
      throw Object.assign(new Error('WORKBENCH_NOT_BUSY'), { code: 'WORKBENCH_NOT_BUSY' });
    }
    next.buildTick += 1;
    if (next.buildTick < 3) return next;
    action = 'complete';
  }
  // complete or run (one-shot)
  if (action === 'run') {
    if (availableBudget(next) < WORKBENCH_BUILD_RESERVE && !next.busy) {
      throw Object.assign(new Error('WORKBENCH_BUDGET_INSUFFICIENT'), { code: 'WORKBENCH_BUDGET_INSUFFICIENT' });
    }
    if (!next.busy) {
      next.budget.reserved = WORKBENCH_BUILD_RESERVE;
      pushHistory(next, '授权模板制作，上限 ¥120', 'Authorized template build, limit ¥120', at, { mode: 'SIM' });
    }
  } else if (!next.busy && action === 'complete') {
    throw Object.assign(new Error('WORKBENCH_NOT_BUSY'), { code: 'WORKBENCH_NOT_BUSY' });
  }
  if (!next.locked) {
    throw Object.assign(new Error('WORKBENCH_NOT_ACCEPTED'), { code: 'WORKBENCH_NOT_ACCEPTED' });
  }
  next.busy = false;
  next.built = true;
  next.budget.reserved = 0;
  next.budget.spent += WORKBENCH_BUILD_SPEND;
  next.rule = {
    price: next.locked.price,
    threshold: Math.min(50, next.locked.threshold * 2),
    rate: next.locked.rate,
  };
  next.version = 1;
  next.versions.push({
    version: 1,
    rule: { ...next.rule },
    at,
    type: 'template',
  });
  next.pages = 3;
  next.days = next.locked.threshold + 3;
  next.buildTick = 3;
  pushHistory(
    next,
    '首版生成；发生 ¥96，释放 ¥24',
    'First draft built; ¥96 spent, ¥24 released',
    at,
    { mode: 'SIM' },
  );
  next.toast = next.lang === 'zh'
    ? '首版已生成，试着改动页数和交期。'
    : 'Draft ready. Try changing pages and timing.';
  return next;
}

export function applyRunChecks(state: WorkbenchState, at: string): WorkbenchState {
  const next = cloneWorkbenchState(state);
  if (!next.built || !next.locked || !next.rule) {
    throw Object.assign(new Error('WORKBENCH_NOT_BUILT'), { code: 'WORKBENCH_NOT_BUILT' });
  }
  const rule = next.acceptedDelivery
    ? (next.acceptedDelivery.rule as WorkbenchRule)
    : next.submitted
      ? (next.submitted.rule as WorkbenchRule)
      : next.rule;
  const frozen = acceptanceCases(next.locked);
  const results: WorkbenchCaseResult[] = frozen.map((c) => {
    const q = calcQuote(rule, c.pages, c.days);
    return {
      id: c.id,
      z: c.z,
      e: c.e,
      pages: c.pages,
      days: c.days,
      expected: c.expected,
      actual: q ? q.total : null,
      pass: !!q && q.total === c.expected,
    };
  });
  next.tests = {
    version: next.version,
    requirements: 'R1',
    results,
    at,
  };
  next.checks.push(immutableJsonCopy(next.tests));
  next.panel = 'default';
  const failures = results.filter((c) => !c.pass);
  if (failures.length) {
    const c = failures[0]!;
    next.selectedCase = c.id;
    next.pages = c.pages;
    next.days = c.days;
  }
  pushHistory(
    next,
    failures.length ? '验收案例发现计算差异' : '三个验收案例通过',
    failures.length ? 'Acceptance cases found a calculation mismatch' : 'All three cases passed',
    at,
  );
  return next;
}

export function applyPatch(
  state: WorkbenchState,
  patch: Record<string, unknown>,
): WorkbenchState {
  const next = cloneWorkbenchState(state);
  if (typeof patch.lang === 'string' && (patch.lang === 'zh' || patch.lang === 'en')) {
    next.lang = patch.lang;
  }
  if (typeof patch.role === 'string' && (patch.role === 'maker' || patch.role === 'client')) {
    if (next.built) next.role = patch.role;
  }
  if (typeof patch.panel === 'string') next.panel = patch.panel;
  if (typeof patch.stage === 'string') {
    const stage = patch.stage as WorkbenchStage;
    const ok = stage === 'brief'
      || (next.accepted && stage === 'craft')
      || (next.built && stage === 'check')
      || ((!!next.submitted || !!next.acceptedDelivery) && stage === 'deliver');
    if (ok) {
      next.stage = stage;
      next.panel = 'default';
      if (stage === 'check') next.role = 'client';
    }
  }
  if (typeof patch.pages === 'number' && Number.isInteger(patch.pages)) {
    next.pages = Math.max(1, Math.min(30, patch.pages));
    next.selectedCase = '';
  }
  if (typeof patch.days === 'number' && Number.isInteger(patch.days)) {
    next.days = Math.max(1, Math.min(60, patch.days));
    next.selectedCase = '';
  }
  if (typeof patch.selectedCase === 'string') next.selectedCase = patch.selectedCase;
  if (typeof patch.toast === 'string') next.toast = patch.toast;
  if (!next.accepted && patch.req && typeof patch.req === 'object') {
    const req = patch.req as Partial<WorkbenchReq>;
    next.req = {
      title: typeof req.title === 'string' ? req.title.slice(0, 30) : next.req.title,
      price: typeof req.price === 'number' ? req.price : next.req.price,
      threshold: typeof req.threshold === 'number' ? req.threshold : next.req.threshold,
      rate: typeof req.rate === 'number' ? req.rate : next.req.rate,
    };
  }
  if (typeof patch.previewVersion === 'number') next.previewVersion = patch.previewVersion;
  return next;
}

export function applyFeedback(
  state: WorkbenchState,
  text: string,
  at: string,
): WorkbenchState {
  const next = cloneWorkbenchState(state);
  if (!next.built || next.acceptedDelivery) {
    throw Object.assign(new Error('WORKBENCH_FEEDBACK_INVALID'), { code: 'WORKBENCH_FEEDBACK_INVALID' });
  }
  const trimmed = text.trim();
  if (!trimmed) {
    throw Object.assign(new Error('WORKBENCH_FEEDBACK_EMPTY'), { code: 'WORKBENCH_FEEDBACK_EMPTY' });
  }
  const displayRule: WorkbenchRule | null = next.acceptedDelivery
    ? ((next.acceptedDelivery as { rule?: WorkbenchRule }).rule ?? null)
    : next.submitted
      ? ((next.submitted as { rule?: WorkbenchRule }).rule ?? null)
      : next.rule;
  const q = calcQuote(displayRule, next.pages, next.days);
  if (!q) {
    throw Object.assign(new Error('WORKBENCH_QUOTE_INVALID'), { code: 'WORKBENCH_QUOTE_INVALID' });
  }
  const wasSubmitted = !!next.submitted;
  if (next.comment) next.feedbackHistory.push(immutableJsonCopy(next.comment));
  next.comment = {
    id: `F-${next.history.length + 1}`,
    text: trimmed,
    anchor: 'rush-fee',
    version: next.version,
    inputs: { pages: next.pages, days: next.days },
    snapshot: q,
    status: 'open',
    at,
    environment: 'local-demo',
    from: wasSubmitted ? 'submission' : 'preview',
  };
  if (next.submitted) {
    next.submissions.push({ ...immutableJsonCopy(next.submitted), status: 'returned' });
    next.submitted = null;
  }
  next.role = 'client';
  next.stage = 'check';
  next.panel = 'comment';
  pushHistory(next, '客户在加急费用处提出修改', 'Client requested a change on the rush fee', at);
  next.toast = '';
  return next;
}

export function applyReply(
  state: WorkbenchState,
  response: string,
  at: string,
): WorkbenchState {
  const next = cloneWorkbenchState(state);
  if (!next.comment || next.comment.status !== 'open' || next.acceptedDelivery) {
    throw Object.assign(new Error('WORKBENCH_REPLY_INVALID'), { code: 'WORKBENCH_REPLY_INVALID' });
  }
  const trimmed = response.trim();
  if (!trimmed) {
    throw Object.assign(new Error('WORKBENCH_REPLY_EMPTY'), { code: 'WORKBENCH_REPLY_EMPTY' });
  }
  next.comment = {
    ...next.comment,
    response: trimmed,
    respondedAt: at,
    status: 'recheck',
  };
  next.role = 'client';
  next.stage = 'check';
  next.panel = 'default';
  pushHistory(next, '回复客户反馈，等待客户确认', 'Replied to feedback, awaiting client confirmation', at);
  return next;
}

export function applyRules(
  state: WorkbenchState,
  rule: WorkbenchRule,
  at: string,
): WorkbenchState {
  const next = cloneWorkbenchState(state);
  if (!next.built || next.role !== 'maker' || next.submitted || next.acceptedDelivery) {
    throw Object.assign(new Error('WORKBENCH_RULES_LOCKED'), { code: 'WORKBENCH_RULES_LOCKED' });
  }
  if (!validEditRule(rule)) {
    throw Object.assign(new Error('WORKBENCH_RULE_INVALID'), { code: 'WORKBENCH_RULE_INVALID' });
  }
  if (
    next.rule
    && next.rule.price === rule.price
    && next.rule.threshold === rule.threshold
    && next.rule.rate === rule.rate
  ) {
    throw Object.assign(new Error('WORKBENCH_RULE_UNCHANGED'), { code: 'WORKBENCH_RULE_UNCHANGED' });
  }
  const previous = next.rule ? { ...next.rule } : null;
  next.rule = { price: rule.price, threshold: rule.threshold, rate: rule.rate };
  next.version += 1;
  const versionEntry: WorkbenchState['versions'][number] = {
    version: next.version,
    rule: { ...next.rule },
    at,
    type: 'edit',
    comment: next.comment ? next.comment.id : null,
  };
  if (previous) versionEntry.previous = previous;
  next.versions.push(versionEntry);
  next.tests = null;
  if (next.comment) next.comment = { ...next.comment, status: 'recheck' };
  next.stage = 'check';
  next.role = 'client';
  next.panel = 'default';
  pushHistory(
    next,
    `修改加急规则 ${previous?.threshold ?? '?'} → ${next.rule.threshold} 天`,
    `Changed rush rule ${previous?.threshold ?? '?'} → ${next.rule.threshold} days`,
    at,
  );
  next.toast = next.lang === 'zh'
    ? '新版本已更新，复查同一个案例。'
    : 'New version ready. Recheck the same case.';
  return next;
}

export function applyResolveFeedback(state: WorkbenchState, at: string): WorkbenchState {
  const next = cloneWorkbenchState(state);
  if (
    next.role !== 'client'
    || !next.comment
    || next.comment.status !== 'recheck'
    || !testReady(next)
  ) {
    throw Object.assign(new Error('WORKBENCH_RESOLVE_INVALID'), { code: 'WORKBENCH_RESOLVE_INVALID' });
  }
  next.comment = {
    ...next.comment,
    status: 'resolved',
    resolvedVersion: next.version,
    resolvedAt: at,
  };
  pushHistory(next, '客户确认反馈已解决', 'Client confirmed the revision', at);
  next.role = 'maker';
  next.stage = 'craft';
  next.panel = 'default';
  next.toast = '';
  return next;
}

export function applySubmit(state: WorkbenchState, at: string): WorkbenchState {
  const next = cloneWorkbenchState(state);
  if (!canSubmit(next) || !next.locked || !next.rule || !next.tests) {
    throw Object.assign(new Error('WORKBENCH_SUBMIT_INVALID'), { code: 'WORKBENCH_SUBMIT_INVALID' });
  }
  next.submitted = {
    id: `D-${next.version}`,
    version: next.version,
    title: next.locked.title,
    rule: { ...next.rule },
    requirements: { ...next.locked },
    tests: immutableJsonCopy(next.tests),
    comment: next.comment ? immutableJsonCopy(next.comment) : null,
    submittedAt: at,
    environment: 'local-demo',
  };
  next.stage = 'deliver';
  next.panel = 'default';
  next.toast = '';
  pushHistory(
    next,
    `提交 v0.${next.version}，冻结交付内容`,
    `Submitted v0.${next.version}, delivery frozen`,
    at,
  );
  return next;
}

export function applyWithdraw(state: WorkbenchState, at: string): WorkbenchState {
  const next = cloneWorkbenchState(state);
  if (!next.submitted || next.acceptedDelivery) {
    throw Object.assign(new Error('WORKBENCH_WITHDRAW_INVALID'), { code: 'WORKBENCH_WITHDRAW_INVALID' });
  }
  next.submissions.push({ ...immutableJsonCopy(next.submitted), status: 'withdrawn' });
  next.submitted = null;
  next.stage = 'craft';
  next.role = 'maker';
  next.panel = 'default';
  pushHistory(next, '撤回待验收提交', 'Withdrew the pending submission', at);
  return next;
}

export function applyReturnDelivery(
  state: WorkbenchState,
  text: string,
  at: string,
): WorkbenchState {
  return applyFeedback(state, text || '请按 R1 修订后重新提交。', at);
}

export function applyAcceptDelivery(state: WorkbenchState, at: string): WorkbenchState {
  const next = cloneWorkbenchState(state);
  if (
    next.role !== 'client'
    || !next.submitted
    || next.acceptedDelivery
    || next.payable
  ) {
    throw Object.assign(new Error('WORKBENCH_ACCEPT_DELIVERY_INVALID'), {
      code: 'WORKBENCH_ACCEPT_DELIVERY_INVALID',
    });
  }
  const submitted = next.submitted as {
    version: number;
    rule: WorkbenchRule;
    tests: { results: WorkbenchCaseResult[] };
  };
  if (
    submitted.version !== next.version
    || !submitted.tests.results.every((x) => x.pass)
    || !ruleMatchesRequirements(next, submitted.rule)
  ) {
    throw Object.assign(new Error('WORKBENCH_ACCEPT_DELIVERY_INVALID'), {
      code: 'WORKBENCH_ACCEPT_DELIVERY_INVALID',
    });
  }
  next.acceptedDelivery = { ...immutableJsonCopy(next.submitted), acceptedAt: at };
  next.payable = {
    id: 'AP-C01-T01',
    contract: 'C-01',
    milestone: 'T-01',
    amount: WORKBENCH_CONTRACT_FEE,
    paid: 0,
    status: 'PAYABLE',
    createdAt: at,
    dueAt: new Date(Date.parse(at) + 7 * 86400000).toISOString(),
    version: next.version,
    environment: 'local-demo',
  };
  next.submissions.push({ ...immutableJsonCopy(next.submitted), status: 'accepted' });
  next.submitted = null;
  pushHistory(
    next,
    '客户验收完成，形成 ¥600 应付，尚未支付',
    'Client accepted; ¥600 payable created, unpaid',
    at,
  );
  next.panel = 'default';
  next.toast = '';
  return next;
}

export function applyRegisterAsset(state: WorkbenchState, at: string): WorkbenchState {
  const next = cloneWorkbenchState(state);
  if (!next.acceptedDelivery || next.asset) {
    throw Object.assign(new Error('WORKBENCH_ASSET_INVALID'), { code: 'WORKBENCH_ASSET_INVALID' });
  }
  next.asset = {
    id: 'A-01',
    scope: 'lightboat-design-team',
    items: ['quote-tool.html'],
    version: next.version,
    originDelivery: (next.acceptedDelivery as { id?: string }).id ?? null,
    rights: 'demo-code-team-reuse',
    registeredAt: at,
    savedAt: at,
    license: 'demo-team-reuse',
  };
  next.panel = 'asset';
  pushHistory(
    next,
    '报价器保存为团队资产，客户资料未共享',
    'Saved tool to team assets; client material not shared',
    at,
  );
  return next;
}

export function buildDeliveryHtml(delivery: {
  title: string;
  version: number;
  rule: WorkbenchRule;
}): string {
  const r = delivery.rule;
  const title = delivery.title;
  const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]!));
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{font-family:system-ui,sans-serif;max-width:520px;margin:50px auto;padding:24px;color:#24262e;background:#f5f4f1}main{padding:30px;background:white;border:1px solid #ddd;border-radius:16px}h1{font-size:26px}label{display:block;margin:18px 0 6px}input{font:inherit;padding:10px;border:1px solid #ccc;border-radius:8px;box-sizing:border-box;width:100%}dl{background:#f5f4f1;padding:18px;border-radius:10px}dt{float:left}dd{text-align:right;margin:12px 0}strong{font-size:28px}small{color:#666}footer{margin-top:20px;font-size:12px}#error{color:#a34e0d}</style><main><small>LIGHTBOAT · v0.${delivery.version} · 本地演示产物</small><h1>${esc(title)}</h1><label for="p">网站页数</label><input id="p" type="number" min="1" max="30" step="1" value="3"><label for="d">期望交期 天</label><input id="d" type="number" min="1" max="60" step="1" value="10"><p id="error" role="alert"></p><dl><dt>页面制作</dt><dd id="b"></dd><dt>加急费</dt><dd id="f"></dd><dt>预计报价</dt><dd><strong id="t" aria-live="polite"></strong></dd></dl><footer>每页 ¥${r.price} · 交期少于 ${r.threshold} 天加收 ${r.rate}%<br>独立离线报价演示，不包含真实客户支付或交易功能。</footer></main><script>const rule=${JSON.stringify(r)};function calc(rule,pages,days){if(!rule||!Number.isInteger(pages)||pages<1||pages>30||!Number.isInteger(days)||days<1||days>60)return null;const base=pages*rule.price,fee=days<rule.threshold?Math.round(base*rule.rate/100):0;return{base,fee,total:base+fee};}const p=document.getElementById('p'),d=document.getElementById('d');function update(){const q=calc(rule,Number(p.value),Number(d.value));document.getElementById('error').textContent=q?'':'请填写 1–30 页和 1–60 天，均为整数。';for(const [id,key] of [['b','base'],['f','fee'],['t','total']])document.getElementById(id).textContent=q?'¥'+q[key].toLocaleString('en-US'):'—';}p.addEventListener('input',update);d.addEventListener('input',update);update();<\/script></html>`;
}

function crc32(bytes: Uint8Array): number {
  let crc = -1;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ -1) >>> 0;
}

export function buildZipBuffer(files: ReadonlyArray<readonly [string, string]>): Buffer {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const n = enc.encode(name);
    const data = enc.encode(text);
    const crc = crc32(data);
    const h = new Uint8Array(30 + n.length);
    const v = new DataView(h.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x0800, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, data.length, true);
    v.setUint32(22, data.length, true);
    v.setUint16(26, n.length, true);
    h.set(n, 30);
    parts.push(h, data);
    const c = new Uint8Array(46 + n.length);
    const w = new DataView(c.buffer);
    w.setUint32(0, 0x02014b50, true);
    w.setUint16(4, 20, true);
    w.setUint16(6, 20, true);
    w.setUint16(8, 0x0800, true);
    w.setUint32(16, crc, true);
    w.setUint32(20, data.length, true);
    w.setUint32(24, data.length, true);
    w.setUint16(28, n.length, true);
    w.setUint32(42, offset, true);
    c.set(n, 46);
    central.push(c);
    offset += h.length + data.length;
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, centralSize, true);
  e.setUint32(16, offset, true);
  return Buffer.concat([...parts, ...central, end]);
}

export function buildDeliveryZip(state: WorkbenchState): Buffer {
  if (!state.acceptedDelivery) {
    throw Object.assign(new Error('WORKBENCH_NO_DELIVERY'), { code: 'WORKBENCH_NO_DELIVERY' });
  }
  const d = state.acceptedDelivery as {
    title: string;
    version: number;
    rule: WorkbenchRule;
  };
  const record = {
    environment: 'local-demo',
    project: 'Lightboat',
    task: 'T-01',
    delivery: state.acceptedDelivery,
    contract: state.contract,
    comment: state.comment,
    feedbackHistory: state.feedbackHistory,
    versions: state.versions,
    submissions: state.submissions,
    checks: state.checks,
    payable: state.payable,
    budget: {
      ...state.budget,
      contractObligation: obligation(state),
      available: availableBudget(state),
    },
    history: state.history,
    marketEvidence: { realPayments: 0, status: 'not_tested' },
  };
  const files: Array<[string, string]> = [
    ['quote-tool.html', buildDeliveryHtml(d)],
    ['delivery-record.json', JSON.stringify(record, null, 2)],
    [
      'README.txt',
      'Lightboat delivery / 本地演示交付\n\n'
        + '打开 quote-tool.html 即可独立试算。\n'
        + '规则与版本冻结在 delivery-record.json。\n'
        + '客户、验收与 ¥600 应付均为演示记录；尚未支付。\n'
        + '本次验收不能证明真实需求或付费意愿。\n'
        + 'HTML 导出为中文（演示）；壳层 UI 支持 zh/en。\n',
    ],
  ];
  return buildZipBuffer(files);
}
