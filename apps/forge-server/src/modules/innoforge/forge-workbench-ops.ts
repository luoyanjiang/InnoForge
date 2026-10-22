import { ForgeLoopError, type ForgeAudit } from './forge-loop.js';
import type { ForgeTask } from './forge-tasks.js';
import {
  WORKBENCH_DEMO_INTENT_ID,
  applyAcceptContract,
  applyAcceptDelivery,
  applyBuild,
  applyFeedback,
  applyPatch,
  applyRegisterAsset,
  applyReply,
  applyResolveFeedback,
  applyReturnDelivery,
  applyRules,
  applyRunChecks,
  applySubmit,
  applyWithdraw,
  buildDeliveryZip,
  cloneWorkbenchState,
  freezeWorkbenchState,
  freshWorkbenchState,
  type WorkbenchRule,
  type WorkbenchState,
} from './forge-workbench.js';

export type WorkbenchView = Readonly<{
  intentId: string;
  tenantId: string;
  state: WorkbenchState;
  updatedAt: string;
  updatedBy: string;
}>;

export type WorkbenchPersistence = {
  load(intentId: string, tenantId: string): Promise<WorkbenchView | undefined>;
  save(input: {
    intentId: string;
    tenantId: string;
    state: WorkbenchState;
    audit: ForgeAudit;
  }): Promise<WorkbenchView>;
  ensureDemoIntent(audit: ForgeAudit): Promise<{ intentId: string }>;
  ensureTaskT01(input: {
    intentId: string;
    audit: ForgeAudit;
  }): Promise<ForgeTask>;
  appendEvent(input: {
    intentId: string;
    type: string;
    audit: ForgeAudit;
    payload: Record<string, unknown>;
  }): Promise<void>;
};

function rethrowWorkbench(error: unknown): never {
  if (error instanceof ForgeLoopError) throw error;
  if (error instanceof Error && 'code' in error && typeof (error as { code: unknown }).code === 'string') {
    throw new ForgeLoopError((error as { code: string }).code);
  }
  throw error;
}

export async function ensureWorkbench(
  store: WorkbenchPersistence,
  input: { intentId?: string; lang?: 'zh' | 'en'; audit: ForgeAudit },
): Promise<WorkbenchView> {
  const intentId = input.intentId ?? WORKBENCH_DEMO_INTENT_ID;
  if (intentId === WORKBENCH_DEMO_INTENT_ID) {
    await store.ensureDemoIntent(input.audit);
  }
  const existing = await store.load(intentId, input.audit.tenantId);
  if (existing) return existing;
  const state = freshWorkbenchState(input.lang ?? 'zh');
  const saved = await store.save({
    intentId,
    tenantId: input.audit.tenantId,
    state,
    audit: input.audit,
  });
  await store.appendEvent({
    intentId,
    type: 'forge.workbench.seeded',
    audit: input.audit,
    payload: { schema: state.schema, demo: true },
  });
  return saved;
}

export async function getWorkbench(
  store: WorkbenchPersistence,
  input: { intentId: string; tenantId: string; lang?: 'zh' | 'en'; audit?: ForgeAudit },
): Promise<WorkbenchView> {
  const existing = await store.load(input.intentId, input.tenantId);
  if (existing) return existing;
  if (!input.audit) throw new ForgeLoopError('WORKBENCH_NOT_FOUND');
  return ensureWorkbench(store, {
    intentId: input.intentId,
    ...(input.lang ? { lang: input.lang } : {}),
    audit: input.audit,
  });
}

async function mutate(
  store: WorkbenchPersistence,
  input: {
    intentId: string;
    audit: ForgeAudit;
    eventType: string;
    payload?: Record<string, unknown>;
    transform: (state: WorkbenchState) => WorkbenchState;
  },
): Promise<WorkbenchView> {
  const current = await getWorkbench(store, {
    intentId: input.intentId,
    tenantId: input.audit.tenantId,
    audit: input.audit,
  });
  let nextState: WorkbenchState;
  try {
    nextState = input.transform(cloneWorkbenchState(current.state));
  } catch (error) {
    rethrowWorkbench(error);
  }
  const saved = await store.save({
    intentId: input.intentId,
    tenantId: input.audit.tenantId,
    state: freezeWorkbenchState(nextState),
    audit: input.audit,
  });
  await store.appendEvent({
    intentId: input.intentId,
    type: input.eventType,
    audit: input.audit,
    payload: input.payload ?? {},
  });
  return saved;
}

export async function patchWorkbench(
  store: WorkbenchPersistence,
  input: { intentId: string; patch: Record<string, unknown>; audit: ForgeAudit },
): Promise<WorkbenchView> {
  return mutate(store, {
    intentId: input.intentId,
    audit: input.audit,
    eventType: 'forge.workbench.patched',
    payload: { keys: Object.keys(input.patch) },
    transform: (state) => applyPatch(state, input.patch),
  });
}

export async function acceptWorkbench(
  store: WorkbenchPersistence,
  input: { intentId: string; audit: ForgeAudit },
): Promise<WorkbenchView> {
  const view = await mutate(store, {
    intentId: input.intentId,
    audit: input.audit,
    eventType: 'forge.workbench.accepted',
    transform: (state) => applyAcceptContract(state, input.audit.occurredAt),
  });
  const task = await store.ensureTaskT01({
    intentId: input.intentId,
    audit: input.audit,
  });
  if (view.state.taskId !== task.id) {
    const withTask = cloneWorkbenchState(view.state);
    withTask.taskId = task.id;
    return store.save({
      intentId: input.intentId,
      tenantId: input.audit.tenantId,
      state: freezeWorkbenchState(withTask),
      audit: input.audit,
    });
  }
  return view;
}

export async function buildWorkbench(
  store: WorkbenchPersistence,
  input: {
    intentId: string;
    action?: 'start' | 'tick' | 'complete' | 'pause' | 'run';
    audit: ForgeAudit;
  },
): Promise<WorkbenchView> {
  const action = input.action ?? 'run';
  return mutate(store, {
    intentId: input.intentId,
    audit: input.audit,
    eventType: action === 'pause' ? 'forge.workbench.build_paused' : 'forge.workbench.built',
    payload: { action, mode: 'SIM' },
    transform: (state) => applyBuild(state, action, input.audit.occurredAt),
  });
}

export async function runWorkbenchChecks(
  store: WorkbenchPersistence,
  input: { intentId: string; audit: ForgeAudit },
): Promise<WorkbenchView> {
  return mutate(store, {
    intentId: input.intentId,
    audit: input.audit,
    eventType: 'forge.workbench.checked',
    transform: (state) => applyRunChecks(state, input.audit.occurredAt),
  });
}

export async function feedbackWorkbench(
  store: WorkbenchPersistence,
  input: { intentId: string; text: string; audit: ForgeAudit },
): Promise<WorkbenchView> {
  return mutate(store, {
    intentId: input.intentId,
    audit: input.audit,
    eventType: 'forge.workbench.feedback',
    transform: (state) => applyFeedback(state, input.text, input.audit.occurredAt),
  });
}

export async function replyWorkbench(
  store: WorkbenchPersistence,
  input: { intentId: string; response: string; audit: ForgeAudit },
): Promise<WorkbenchView> {
  return mutate(store, {
    intentId: input.intentId,
    audit: input.audit,
    eventType: 'forge.workbench.reply',
    transform: (state) => applyReply(state, input.response, input.audit.occurredAt),
  });
}

export async function rulesWorkbench(
  store: WorkbenchPersistence,
  input: { intentId: string; rule: WorkbenchRule; audit: ForgeAudit },
): Promise<WorkbenchView> {
  return mutate(store, {
    intentId: input.intentId,
    audit: input.audit,
    eventType: 'forge.workbench.rules',
    payload: { versionBump: true },
    transform: (state) => applyRules(state, input.rule, input.audit.occurredAt),
  });
}

export async function resolveFeedbackWorkbench(
  store: WorkbenchPersistence,
  input: { intentId: string; audit: ForgeAudit },
): Promise<WorkbenchView> {
  return mutate(store, {
    intentId: input.intentId,
    audit: input.audit,
    eventType: 'forge.workbench.feedback_resolved',
    transform: (state) => applyResolveFeedback(state, input.audit.occurredAt),
  });
}

export async function submitWorkbench(
  store: WorkbenchPersistence,
  input: { intentId: string; audit: ForgeAudit },
): Promise<WorkbenchView> {
  return mutate(store, {
    intentId: input.intentId,
    audit: input.audit,
    eventType: 'forge.workbench.submitted',
    transform: (state) => applySubmit(state, input.audit.occurredAt),
  });
}

export async function withdrawWorkbench(
  store: WorkbenchPersistence,
  input: { intentId: string; audit: ForgeAudit },
): Promise<WorkbenchView> {
  return mutate(store, {
    intentId: input.intentId,
    audit: input.audit,
    eventType: 'forge.workbench.withdrawn',
    transform: (state) => applyWithdraw(state, input.audit.occurredAt),
  });
}

export async function returnWorkbench(
  store: WorkbenchPersistence,
  input: { intentId: string; text?: string; audit: ForgeAudit },
): Promise<WorkbenchView> {
  return mutate(store, {
    intentId: input.intentId,
    audit: input.audit,
    eventType: 'forge.workbench.returned',
    transform: (state) => applyReturnDelivery(
      state,
      input.text ?? '',
      input.audit.occurredAt,
    ),
  });
}

export async function acceptDeliveryWorkbench(
  store: WorkbenchPersistence,
  input: { intentId: string; audit: ForgeAudit },
): Promise<WorkbenchView> {
  return mutate(store, {
    intentId: input.intentId,
    audit: input.audit,
    eventType: 'forge.workbench.delivery_accepted',
    payload: { payable: true },
    transform: (state) => applyAcceptDelivery(state, input.audit.occurredAt),
  }).then(async (view) => {
    await store.appendEvent({
      intentId: input.intentId,
      type: 'forge.workbench.payable_created',
      audit: input.audit,
      payload: {
        amount: view.state.payable?.amount ?? 0,
        status: view.state.payable?.status ?? 'PAYABLE',
        paid: 0,
      },
    });
    return view;
  });
}

export async function registerAssetWorkbench(
  store: WorkbenchPersistence,
  input: { intentId: string; audit: ForgeAudit },
): Promise<WorkbenchView> {
  return mutate(store, {
    intentId: input.intentId,
    audit: input.audit,
    eventType: 'forge.workbench.asset_registered',
    transform: (state) => applyRegisterAsset(state, input.audit.occurredAt),
  });
}

export async function resetWorkbench(
  store: WorkbenchPersistence,
  input: { intentId: string; audit: ForgeAudit },
): Promise<WorkbenchView> {
  const current = await getWorkbench(store, {
    intentId: input.intentId,
    tenantId: input.audit.tenantId,
    audit: input.audit,
  });
  if (!current.state.demo) {
    throw new ForgeLoopError('WORKBENCH_RESET_DENIED');
  }
  const lang = current.state.lang;
  const state = freshWorkbenchState(lang);
  const saved = await store.save({
    intentId: input.intentId,
    tenantId: input.audit.tenantId,
    state,
    audit: input.audit,
  });
  await store.appendEvent({
    intentId: input.intentId,
    type: 'forge.workbench.reset',
    audit: input.audit,
    payload: { demo: true },
  });
  return saved;
}

export async function deliveryZipWorkbench(
  store: WorkbenchPersistence,
  input: { intentId: string; tenantId: string },
): Promise<{ filename: string; buffer: Buffer }> {
  const view = await store.load(input.intentId, input.tenantId);
  if (!view) throw new ForgeLoopError('WORKBENCH_NOT_FOUND');
  try {
    const buffer = buildDeliveryZip(view.state);
    const version = (view.state.acceptedDelivery as { version?: number } | null)?.version ?? view.state.version;
    return {
      filename: `lightboat-delivery-v0.${version}.zip`,
      buffer,
    };
  } catch (error) {
    rethrowWorkbench(error);
  }
}
