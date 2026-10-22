import { createHash, randomUUID } from 'node:crypto';

import type { ExternalJob } from '../../../../../packages/adapters/src/external-adapter.js';
import { immutableJsonCopy } from '../../../../../packages/domain/src/canonical-json.js';
import {
  constraintsEqual,
  normalizeConstraints,
  type ForgeConstraint,
} from './forge-constraints.js';
import {
  findCandidate,
  freezeJudgment,
  judgmentIdFor,
  listDefaultCandidates,
  normalizeJudgmentAction,
  type ForgeJudgment,
  type ForgeVariantCandidate,
} from './forge-judgments.js';
import { ExternalAdapterRegistry } from './external-registry.js';
import {
  InMemoryForgePxnBridge,
  type ForgePxnBridge,
  type ForgePxnPath,
} from './pxn-bridge.js';
import { buildTimeline, type ForgeTimelineItem } from './forge-timeline.js';
import {
  allocationAmountsByPrincipal,
  computeCreditAllocations,
  DEFAULT_ALLOCATION_WEIGHTS,
  type ForgeAllocationWeights,
  type ForgeCreditAllocation,
} from './forge-allocations.js';
import {
  buildReputation,
  computeReputationScore,
  type ForgeReputation,
} from './forge-reputation.js';
import {
  freezeSnapshot,
  hashSnapshotContent,
  snapshotIdFor,
  summarizeJudgments,
  type ForgeSnapshot,
} from './forge-snapshots.js';
import {
  freezeLifeform,
  freezeProposal,
  lifeformIdFor,
  newProposalId,
  type ForgeLifeform,
  type ForgeLifeformProposal,
  type ForgeLifeformStatus,
} from './forge-lifeforms.js';

export type { ForgeConstraint } from './forge-constraints.js';
export type { ForgeJudgment, ForgeJudgmentAction, ForgeVariantCandidate } from './forge-judgments.js';
export type { ForgeTimelineItem, ForgeTimelineKind } from './forge-timeline.js';
export type {
  ForgeAllocationRole,
  ForgeAllocationWeights,
  ForgeCreditAllocation,
} from './forge-allocations.js';
export { DEFAULT_ALLOCATION_WEIGHTS } from './forge-allocations.js';
export type { ForgeReputation } from './forge-reputation.js';
export { REPUTATION_BASELINE } from './forge-reputation.js';
export type { ForgeSnapshot } from './forge-snapshots.js';
export type {
  ForgeLifeform,
  ForgeLifeformProposal,
  ForgeLifeformProposalStatus,
  ForgeLifeformStatus,
} from './forge-lifeforms.js';

export type ForgeLoopStatus =
  | 'DRAFT'
  | 'STAKED'
  | 'CONFIRMED'
  | 'DEPLOYING'
  | 'FEEDBACK'
  | 'SETTLED'
  | 'REJECTED';

export type ForgeAudit = Readonly<{
  actorId: string;
  idempotencyKey: string;
  requestId: string;
  occurredAt: string;
  tenantId: string;
}>;

export type ForgeIntent = Readonly<{
  id: string;
  tenantId: string;
  principalId: string;
  statement: string;
  constraints: readonly ForgeConstraint[];
  frozen: boolean;
  stake: number;
  status: ForgeLoopStatus;
  adapterId: string;
  pxnTaskId?: string;
  pxnPath?: ForgePxnPath;
  deployJobId?: string;
  deployJob?: ExternalJob;
  creditMinted?: number;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
  settledAt?: string;
  events: readonly ForgeEvent[];
}>;

export type ForgeEvent = Readonly<{
  id: string;
  type: string;
  at: string;
  actorId: string;
  payload: Readonly<Record<string, unknown>>;
}>;

export type CreditAccount = Readonly<{
  tenantId: string;
  principalId: string;
  balance: number;
  staked: number;
  reputation: ForgeReputation;
}>;

export interface ForgeLoopService {
  ensureAccount(input: { tenantId: string; principalId: string; openingBalance?: number }): Promise<CreditAccount>;
  getAccount(input: { tenantId: string; principalId: string }): Promise<CreditAccount | undefined>;
  topUp(input: { tenantId: string; principalId: string; amount: number; audit: ForgeAudit }): Promise<CreditAccount>;
  createIntent(input: {
    id: string;
    statement: string;
    stake: number;
    constraints?: readonly ForgeConstraint[] | unknown;
    adapterId?: string;
    pxnTaskId?: string;
    audit: ForgeAudit;
  }): Promise<ForgeIntent>;
  updateIntent(input: {
    id: string;
    statement?: string;
    constraints?: readonly ForgeConstraint[] | unknown;
    frozen?: boolean;
    audit: ForgeAudit;
  }): Promise<ForgeIntent>;
  confirm(input: { id: string; audit: ForgeAudit }): Promise<ForgeIntent>;
  deploy(input: { id: string; audit: ForgeAudit }): Promise<ForgeIntent>;
  feedback(input: { id: string; audit: ForgeAudit }): Promise<ForgeIntent>;
  get(input: { id: string; tenantId: string }): Promise<ForgeIntent | undefined>;
  listIntents(input: { tenantId: string }): Promise<readonly ForgeIntent[]>;
  listAdapters(): Promise<readonly { adapterId: string; category: string; mode: string; healthy: boolean }[]>;
  listVariantCandidates(): Promise<readonly ForgeVariantCandidate[]>;
  listJudgments(input: { intentId: string; tenantId: string }): Promise<readonly ForgeJudgment[]>;
  recordJudgment(input: {
    intentId: string;
    candidateId: string;
    action: string;
    rationale?: string;
    impact?: string;
    audit: ForgeAudit;
  }): Promise<ForgeJudgment>;
  listTimeline(input: {
    tenantId: string;
    intentId?: string;
  }): Promise<readonly ForgeTimelineItem[]>;
  getAllocationWeights(): Promise<ForgeAllocationWeights>;
  listAllocations(input: {
    intentId: string;
    tenantId: string;
  }): Promise<readonly ForgeCreditAllocation[]>;
  createSnapshot(input: { intentId: string; audit: ForgeAudit }): Promise<ForgeSnapshot>;
  listSnapshots(input: { intentId: string; tenantId: string }): Promise<readonly ForgeSnapshot[]>;
  restoreSnapshot(input: {
    intentId: string;
    snapshotId: string;
    audit: ForgeAudit;
  }): Promise<ForgeIntent>;
  createLifeform(input: {
    intentId: string;
    name?: string;
    audit: ForgeAudit;
  }): Promise<ForgeLifeform>;
  listLifeforms(input: { tenantId: string }): Promise<readonly ForgeLifeform[]>;
  getLifeform(input: { id: string; tenantId: string }): Promise<ForgeLifeform | undefined>;
  addLifeformProposal(input: {
    lifeformId: string;
    summary: string;
    audit: ForgeAudit;
  }): Promise<ForgeLifeform>;
  decideLifeformProposal(input: {
    lifeformId: string;
    proposalId: string;
    decision: 'ACCEPTED' | 'REJECTED';
    audit: ForgeAudit;
  }): Promise<ForgeLifeform>;
  setLifeformStatus(input: {
    lifeformId: string;
    status: Exclude<ForgeLifeformStatus, 'ACTIVE'> | 'ACTIVE';
    audit: ForgeAudit;
  }): Promise<ForgeLifeform>;
}

export class ForgeLoopError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ForgeLoopError';
  }
}

type MutableAccount = { balance: number; staked: number };
type MutableIntent = {
  view: ForgeIntent;
  events: ForgeEvent[];
};

function event(type: string, audit: ForgeAudit, payload: Record<string, unknown> = {}): ForgeEvent {
  return Object.freeze({
    id: `fev:${createHash('sha256').update(`${audit.idempotencyKey}:${type}`).digest('hex').slice(0, 24)}`,
    type,
    at: audit.occurredAt,
    actorId: audit.actorId,
    payload: Object.freeze(payload),
  });
}

/** In-memory Intent OS × InnoForge closed loop on PXN control-plane conventions. */
export class InMemoryForgeLoopService implements ForgeLoopService {
  private readonly accounts = new Map<string, MutableAccount>();
  private readonly intents = new Map<string, MutableIntent>();
  private readonly judgments = new Map<string, ForgeJudgment>();
  private readonly allocations = new Map<string, ForgeCreditAllocation[]>();
  private readonly snapshots = new Map<string, ForgeSnapshot>();
  private readonly lifeforms = new Map<string, ForgeLifeform>();
  private readonly bridge: ForgePxnBridge;

  constructor(
    private readonly registry = new ExternalAdapterRegistry(),
    bridge?: ForgePxnBridge,
  ) {
    this.bridge = bridge ?? new InMemoryForgePxnBridge();
  }

  private resolveConfirmer(intent: ForgeIntent): string {
    const confirmed = [...intent.events].reverse().find((item) => item.type === 'forge.intent.confirmed');
    return confirmed?.actorId ?? intent.principalId;
  }

  private async settleAllocations(input: {
    intent: ForgeIntent;
    minted: number;
    occurredAt: string;
  }): Promise<readonly ForgeCreditAllocation[]> {
    const judgments = await this.listJudgments({
      intentId: input.intent.id,
      tenantId: input.intent.tenantId,
    });
    const suggesterIds = judgments
      .filter((item) => item.action === 'ADOPT')
      .map((item) => item.actorId);
    const allocations = computeCreditAllocations({
      intentId: input.intent.id,
      tenantId: input.intent.tenantId,
      minted: input.minted,
      proposerId: input.intent.principalId,
      suggesterIds,
      confirmerId: this.resolveConfirmer(input.intent),
      occurredAt: input.occurredAt,
    });
    const byPrincipal = allocationAmountsByPrincipal(allocations);
    // Unstake from proposer; credit each recipient their share of minted.
    const proposerKey = this.accountKey(input.intent.tenantId, input.intent.principalId);
    const proposerAccount = this.accounts.get(proposerKey);
    if (!proposerAccount) throw new ForgeLoopError('ACCOUNT_NOT_FOUND');
    proposerAccount.staked -= input.intent.stake;
    for (const [principalId, amount] of byPrincipal) {
      await this.ensureAccount({
        tenantId: input.intent.tenantId,
        principalId,
        openingBalance: 0,
      });
      const account = this.accounts.get(this.accountKey(input.intent.tenantId, principalId));
      if (!account) throw new ForgeLoopError('ACCOUNT_NOT_FOUND');
      account.balance += amount;
    }
    this.allocations.set(input.intent.id, [...allocations]);
    return allocations;
  }

  private accountKey(tenantId: string, principalId: string): string {
    return `${tenantId}::${principalId}`;
  }

  private reputationFor(tenantId: string, principalId: string): ForgeReputation {
    const settledIds = new Set(
      [...this.intents.values()]
        .filter((item) => item.view.tenantId === tenantId && item.view.status === 'SETTLED')
        .map((item) => item.view.id),
    );
    const countsByPrincipal = new Map<string, { adoptSettled: number; rejects: number }>();
    for (const judgment of this.judgments.values()) {
      if (judgment.tenantId !== tenantId) continue;
      const current = countsByPrincipal.get(judgment.actorId) ?? { adoptSettled: 0, rejects: 0 };
      if (judgment.action === 'REJECT') current.rejects += 1;
      if (judgment.action === 'ADOPT' && settledIds.has(judgment.intentId)) current.adoptSettled += 1;
      countsByPrincipal.set(judgment.actorId, current);
    }
    const peerScores = new Map<string, number>();
    for (const [id, counts] of countsByPrincipal) {
      peerScores.set(id, computeReputationScore({
        adoptSettledCount: counts.adoptSettled,
        rejectCount: counts.rejects,
      }));
    }
    const self = countsByPrincipal.get(principalId) ?? { adoptSettled: 0, rejects: 0 };
    return buildReputation({
      principalId,
      adoptSettledCount: self.adoptSettled,
      rejectCount: self.rejects,
      peerScores,
    });
  }

  private toAccountView(
    tenantId: string,
    principalId: string,
    account: MutableAccount,
  ): CreditAccount {
    return Object.freeze({
      tenantId,
      principalId,
      balance: account.balance,
      staked: account.staked,
      reputation: this.reputationFor(tenantId, principalId),
    });
  }

  async ensureAccount(input: {
    tenantId: string;
    principalId: string;
    openingBalance?: number;
  }): Promise<CreditAccount> {
    const key = this.accountKey(input.tenantId, input.principalId);
    let account = this.accounts.get(key);
    if (!account) {
      account = { balance: input.openingBalance ?? 1000, staked: 0 };
      this.accounts.set(key, account);
    }
    return this.toAccountView(input.tenantId, input.principalId, account);
  }

  async getAccount(input: { tenantId: string; principalId: string }): Promise<CreditAccount | undefined> {
    const account = this.accounts.get(this.accountKey(input.tenantId, input.principalId));
    if (!account) return undefined;
    return this.toAccountView(input.tenantId, input.principalId, account);
  }

  async topUp(input: {
    tenantId: string;
    principalId: string;
    amount: number;
    audit: ForgeAudit;
  }): Promise<CreditAccount> {
    if (!(input.amount > 0) || !Number.isFinite(input.amount)) throw new ForgeLoopError('TOPUP_INVALID');
    if (input.audit.tenantId !== input.tenantId) throw new ForgeLoopError('TENANT_SCOPE_MISMATCH');
    await this.ensureAccount({ tenantId: input.tenantId, principalId: input.principalId });
    const mutable = this.accounts.get(this.accountKey(input.tenantId, input.principalId));
    if (!mutable) throw new ForgeLoopError('ACCOUNT_NOT_FOUND');
    mutable.balance += input.amount;
    return this.toAccountView(input.tenantId, input.principalId, mutable);
  }

  async createIntent(input: {
    id: string;
    statement: string;
    stake: number;
    constraints?: readonly ForgeConstraint[] | unknown;
    adapterId?: string;
    pxnTaskId?: string;
    audit: ForgeAudit;
  }): Promise<ForgeIntent> {
    if (input.audit.actorId !== input.audit.tenantId && !input.audit.actorId) {
      throw new ForgeLoopError('ACTOR_REQUIRED');
    }
    if (!(input.stake > 0) || !Number.isFinite(input.stake)) throw new ForgeLoopError('STAKE_INVALID');
    if (!input.statement.trim()) throw new ForgeLoopError('STATEMENT_REQUIRED');
    const constraints = normalizeConstraints(input.constraints);
    const existing = this.intents.get(input.id);
    if (existing) {
      if (existing.view.tenantId !== input.audit.tenantId) throw new ForgeLoopError('TENANT_SCOPE_MISMATCH');
      if (
        existing.view.statement !== input.statement.trim()
        || existing.view.stake !== input.stake
        || !constraintsEqual(existing.view.constraints, constraints)
      ) {
        throw new ForgeLoopError('INTENT_REPLACEMENT_DENIED');
      }
      return existing.view;
    }
    const adapterId = input.adapterId ?? 'mfg-fab';
    if (!this.registry.get(adapterId)) throw new ForgeLoopError('ADAPTER_NOT_FOUND');
    const account = await this.ensureAccount({
      tenantId: input.audit.tenantId,
      principalId: input.audit.actorId,
    });
    const mutable = this.accounts.get(this.accountKey(input.audit.tenantId, input.audit.actorId))!;
    if (mutable.balance < input.stake) throw new ForgeLoopError('INSUFFICIENT_CREDIT');
    mutable.balance -= input.stake;
    mutable.staked += input.stake;
    const pxnPath = await this.bridge.attachOnCreate({
      intentId: input.id,
      statement: input.statement.trim(),
      stake: input.stake,
      adapterId,
      ...(input.pxnTaskId ? { existingTaskId: input.pxnTaskId } : {}),
      audit: input.audit,
    });
    const ev = event('forge.intent.staked', input.audit, {
      stake: input.stake,
      adapterId,
      balanceAfter: mutable.balance,
      pxnTaskId: pxnPath.taskId,
      pxnTaskState: pxnPath.taskState ?? null,
      constraints,
    });
    const view: ForgeIntent = Object.freeze({
      id: input.id,
      tenantId: input.audit.tenantId,
      principalId: input.audit.actorId,
      statement: input.statement.trim(),
      constraints,
      frozen: false,
      stake: input.stake,
      status: 'STAKED',
      adapterId,
      pxnTaskId: pxnPath.taskId,
      pxnPath,
      createdAt: input.audit.occurredAt,
      updatedAt: input.audit.occurredAt,
      events: Object.freeze([ev]),
    });
    this.intents.set(input.id, { view, events: [ev] });
    void account;
    return view;
  }

  async updateIntent(input: {
    id: string;
    statement?: string;
    constraints?: readonly ForgeConstraint[] | unknown;
    frozen?: boolean;
    audit: ForgeAudit;
  }): Promise<ForgeIntent> {
    const record = this.intents.get(input.id);
    if (!record) throw new ForgeLoopError('INTENT_NOT_FOUND');
    if (record.view.tenantId !== input.audit.tenantId) throw new ForgeLoopError('TENANT_SCOPE_MISMATCH');
    if (record.view.status !== 'STAKED' && record.view.status !== 'CONFIRMED') {
      throw new ForgeLoopError('INTENT_NOT_EDITABLE');
    }

    const nextFrozen = input.frozen !== undefined ? Boolean(input.frozen) : record.view.frozen;
    const wantsContent =
      input.statement !== undefined || input.constraints !== undefined;
    if (wantsContent && record.view.frozen && input.frozen !== false) {
      throw new ForgeLoopError('INTENT_FROZEN');
    }

    const nextStatement = input.statement !== undefined
      ? input.statement.trim()
      : record.view.statement;
    if (!nextStatement) throw new ForgeLoopError('STATEMENT_REQUIRED');
    const nextConstraints = input.constraints !== undefined
      ? normalizeConstraints(input.constraints)
      : record.view.constraints;

    const contentChanged =
      nextStatement !== record.view.statement
      || !constraintsEqual(nextConstraints, record.view.constraints);
    const freezeChanged = nextFrozen !== record.view.frozen;
    if (!contentChanged && !freezeChanged) return record.view;

    if (contentChanged) {
      const ev = event('forge.intent.updated', input.audit, {
        statement: nextStatement,
        constraints: nextConstraints,
      });
      record.events.push(ev);
    }
    if (freezeChanged) {
      const ev = event(
        nextFrozen ? 'forge.intent.frozen' : 'forge.intent.unfrozen',
        input.audit,
        { frozen: nextFrozen },
      );
      record.events.push(ev);
    }
    record.view = Object.freeze({
      ...record.view,
      statement: nextStatement,
      constraints: nextConstraints,
      frozen: nextFrozen,
      updatedAt: input.audit.occurredAt,
      events: Object.freeze([...record.events]),
    });
    return record.view;
  }

  async confirm(input: { id: string; audit: ForgeAudit }): Promise<ForgeIntent> {
    const record = this.intents.get(input.id);
    if (!record) throw new ForgeLoopError('INTENT_NOT_FOUND');
    if (record.view.tenantId !== input.audit.tenantId) throw new ForgeLoopError('TENANT_SCOPE_MISMATCH');
    if (record.view.status === 'CONFIRMED' || record.view.status === 'DEPLOYING'
      || record.view.status === 'FEEDBACK' || record.view.status === 'SETTLED') {
      return record.view;
    }
    if (record.view.status !== 'STAKED') throw new ForgeLoopError('INTENT_NOT_CONFIRMABLE');
    const basePath = record.view.pxnPath ?? (record.view.pxnTaskId
      ? Object.freeze({ taskId: record.view.pxnTaskId, mode: 'bridged' as const })
      : undefined);
    if (!basePath) throw new ForgeLoopError('PXN_PATH_REQUIRED');
    // Human sovereignty: confirmer may differ from requester (governance path).
    const pxnPath = await this.bridge.confirmViaApprovals({
      intentId: record.view.id,
      path: basePath,
      audit: input.audit,
    });
    const ev = event('forge.intent.confirmed', input.audit, {
      previousStatus: record.view.status,
      pxnTaskId: pxnPath.taskId,
      approvalId: pxnPath.approvalId ?? null,
      pxnTaskState: pxnPath.taskState ?? null,
    });
    record.events.push(ev);
    record.view = Object.freeze({
      ...record.view,
      status: 'CONFIRMED',
      pxnTaskId: pxnPath.taskId,
      pxnPath,
      updatedAt: input.audit.occurredAt,
      confirmedAt: input.audit.occurredAt,
      events: Object.freeze([...record.events]),
    });
    return record.view;
  }

  async deploy(input: { id: string; audit: ForgeAudit }): Promise<ForgeIntent> {
    const record = this.intents.get(input.id);
    if (!record) throw new ForgeLoopError('INTENT_NOT_FOUND');
    if (record.view.tenantId !== input.audit.tenantId) throw new ForgeLoopError('TENANT_SCOPE_MISMATCH');
    if (record.view.status === 'DEPLOYING' || record.view.status === 'FEEDBACK' || record.view.status === 'SETTLED') {
      return record.view;
    }
    if (record.view.status !== 'CONFIRMED') throw new ForgeLoopError('CONFIRMATION_REQUIRED');
    const adapter = this.registry.get(record.view.adapterId);
    if (!adapter) throw new ForgeLoopError('ADAPTER_NOT_FOUND');
    const jobId = record.view.deployJobId ?? `job:${record.view.id}`;
    const job = await adapter.createJob({
      jobId,
      at: input.audit.occurredAt,
      payload: {
        intentId: record.view.id,
        statement: record.view.statement,
        stake: record.view.stake,
        pxnTaskId: record.view.pxnTaskId ?? null,
        gateway: 'pxn.innoforge.deploy',
      },
    });
    const basePath = record.view.pxnPath ?? (record.view.pxnTaskId
      ? Object.freeze({ taskId: record.view.pxnTaskId, mode: 'bridged' as const })
      : undefined);
    if (!basePath) throw new ForgeLoopError('PXN_PATH_REQUIRED');
    const pxnPath = await this.bridge.recordDeployPath({
      intentId: record.view.id,
      path: basePath,
      deployJobId: job.jobId,
      adapterId: adapter.adapterId,
      audit: input.audit,
    });
    const ev = event('forge.deploy.started', input.audit, {
      jobId: job.jobId,
      adapterId: adapter.adapterId,
      pxnDispatchId: pxnPath.dispatchId ?? null,
      pxnEvidencePackageId: pxnPath.evidencePackageId ?? null,
      pxnTaskState: pxnPath.taskState ?? null,
    });
    record.events.push(ev);
    record.view = Object.freeze({
      ...record.view,
      status: 'DEPLOYING',
      deployJobId: job.jobId,
      deployJob: job,
      pxnPath,
      updatedAt: input.audit.occurredAt,
      events: Object.freeze([...record.events]),
    });
    return record.view;
  }

  async feedback(input: { id: string; audit: ForgeAudit }): Promise<ForgeIntent> {
    const record = this.intents.get(input.id);
    if (!record) throw new ForgeLoopError('INTENT_NOT_FOUND');
    if (record.view.tenantId !== input.audit.tenantId) throw new ForgeLoopError('TENANT_SCOPE_MISMATCH');
    if (record.view.status === 'SETTLED') return record.view;
    if (record.view.status !== 'DEPLOYING' && record.view.status !== 'FEEDBACK') {
      throw new ForgeLoopError('DEPLOY_REQUIRED');
    }
    const adapter = this.registry.get(record.view.adapterId);
    if (!adapter || !record.view.deployJobId) throw new ForgeLoopError('DEPLOY_JOB_MISSING');
    const job = adapter.tick
      ? await adapter.tick(record.view.deployJobId, input.audit.occurredAt)
      : await adapter.getJob(record.view.deployJobId);
    if (!job) throw new ForgeLoopError('DEPLOY_JOB_MISSING');
    const basePath = record.view.pxnPath ?? (record.view.pxnTaskId
      ? Object.freeze({ taskId: record.view.pxnTaskId, mode: 'bridged' as const })
      : undefined);
    if (!basePath) throw new ForgeLoopError('PXN_PATH_REQUIRED');
    const willSettle = job.status === 'SUCCEEDED';
    const pxnPath = await this.bridge.recordFeedbackPath({
      intentId: record.view.id,
      path: basePath,
      jobStatus: job.status,
      settled: willSettle,
      audit: input.audit,
    });
    const tickEvent = event('forge.feedback.tick', input.audit, {
      jobId: job.jobId,
      status: job.status,
      pxnTaskState: pxnPath.taskState ?? null,
      ...(job.result ? { result: job.result } : {}),
    });
    record.events.push(tickEvent);
    if (!willSettle) {
      record.view = Object.freeze({
        ...record.view,
        status: 'FEEDBACK',
        deployJob: job,
        pxnPath,
        updatedAt: input.audit.occurredAt,
        events: Object.freeze([...record.events]),
      });
      return record.view;
    }
    // Simulated value realization: mint 1.5× stake, split by G4 attribution roles.
    const minted = Math.round(record.view.stake * 1.5);
    const allocations = await this.settleAllocations({
      intent: record.view,
      minted,
      occurredAt: input.audit.occurredAt,
    });
    const proposer = await this.getAccount({
      tenantId: record.view.tenantId,
      principalId: record.view.principalId,
    });
    const settleEvent = event('forge.credit.settled', input.audit, {
      minted,
      stakeReturnedAs: record.view.stake,
      reward: minted - record.view.stake,
      balanceAfter: proposer?.balance ?? null,
      allocations: allocations.map((item) => ({
        role: item.role,
        principalId: item.principalId,
        amount: item.amount,
        weightPercent: item.weightPercent,
      })),
      pxnAcceptanceId: pxnPath.acceptanceId ?? null,
      pxnTaskState: pxnPath.taskState ?? null,
    });
    record.events.push(settleEvent);
    record.view = Object.freeze({
      ...record.view,
      status: 'SETTLED',
      deployJob: job,
      creditMinted: minted,
      pxnPath,
      updatedAt: input.audit.occurredAt,
      settledAt: input.audit.occurredAt,
      events: Object.freeze([...record.events]),
    });
    return record.view;
  }

  async get(input: { id: string; tenantId: string }): Promise<ForgeIntent | undefined> {
    const record = this.intents.get(input.id);
    if (!record || record.view.tenantId !== input.tenantId) return undefined;
    return record.view;
  }

  async listIntents(input: { tenantId: string }): Promise<readonly ForgeIntent[]> {
    return [...this.intents.values()]
      .filter(item => item.view.tenantId === input.tenantId)
      .map(item => item.view)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async listAdapters(): Promise<readonly { adapterId: string; category: string; mode: string; healthy: boolean }[]> {
    const health = await this.registry.healthAll();
    return health.map(item => Object.freeze({
      adapterId: item.adapterId,
      category: item.category,
      mode: item.mode,
      healthy: item.healthy,
    }));
  }

  async listVariantCandidates(): Promise<readonly ForgeVariantCandidate[]> {
    return listDefaultCandidates();
  }

  async listJudgments(input: { intentId: string; tenantId: string }): Promise<readonly ForgeJudgment[]> {
    const intent = await this.get({ id: input.intentId, tenantId: input.tenantId });
    if (!intent) throw new ForgeLoopError('INTENT_NOT_FOUND');
    return [...this.judgments.values()]
      .filter((item) => item.intentId === input.intentId && item.tenantId === input.tenantId)
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  }

  async recordJudgment(input: {
    intentId: string;
    candidateId: string;
    action: string;
    rationale?: string;
    impact?: string;
    audit: ForgeAudit;
  }): Promise<ForgeJudgment> {
    const intent = await this.get({ id: input.intentId, tenantId: input.audit.tenantId });
    if (!intent) throw new ForgeLoopError('INTENT_NOT_FOUND');
    if (intent.tenantId !== input.audit.tenantId) throw new ForgeLoopError('TENANT_SCOPE_MISMATCH');
    const action = normalizeJudgmentAction(input.action);
    const candidate = findCandidate(input.candidateId);
    const id = judgmentIdFor(input.intentId, input.candidateId);
    const existing = this.judgments.get(id);
    if (existing) {
      if (existing.action !== action) throw new ForgeLoopError('JUDGMENT_ALREADY_RECORDED');
      return existing;
    }
    const judgment = freezeJudgment({
      id,
      intentId: input.intentId,
      tenantId: input.audit.tenantId,
      actorId: input.audit.actorId,
      candidateId: candidate.id,
      action,
      ...(input.rationale?.trim() ? { rationale: input.rationale.trim() } : {}),
      ...(input.impact?.trim() ? { impact: input.impact.trim() } : { impact: candidate.impact }),
      candidateSnapshot: candidate,
      occurredAt: input.audit.occurredAt,
    });
    this.judgments.set(id, judgment);
    const record = this.intents.get(input.intentId);
    if (record) {
      const ev = event('forge.judgment.recorded', input.audit, {
        judgmentId: judgment.id,
        candidateId: judgment.candidateId,
        action: judgment.action,
        actorId: judgment.actorId,
      });
      record.events.push(ev);
      record.view = Object.freeze({
        ...record.view,
        updatedAt: input.audit.occurredAt,
        events: Object.freeze([...record.events]),
      });
    }
    return judgment;
  }

  async listTimeline(input: {
    tenantId: string;
    intentId?: string;
  }): Promise<readonly ForgeTimelineItem[]> {
    if (input.intentId) {
      const intent = await this.get({ id: input.intentId, tenantId: input.tenantId });
      if (!intent) throw new ForgeLoopError('INTENT_NOT_FOUND');
      const judgments = await this.listJudgments({
        intentId: input.intentId,
        tenantId: input.tenantId,
      });
      return buildTimeline({ intents: [intent], judgments });
    }
    const intents = await this.listIntents({ tenantId: input.tenantId });
    const judgments: ForgeJudgment[] = [];
    for (const intent of intents) {
      judgments.push(
        ...(await this.listJudgments({ intentId: intent.id, tenantId: input.tenantId })),
      );
    }
    return buildTimeline({ intents, judgments });
  }

  async getAllocationWeights(): Promise<ForgeAllocationWeights> {
    return DEFAULT_ALLOCATION_WEIGHTS;
  }

  async listAllocations(input: {
    intentId: string;
    tenantId: string;
  }): Promise<readonly ForgeCreditAllocation[]> {
    const intent = await this.get({ id: input.intentId, tenantId: input.tenantId });
    if (!intent) throw new ForgeLoopError('INTENT_NOT_FOUND');
    return Object.freeze([...(this.allocations.get(input.intentId) ?? [])]);
  }

  async createSnapshot(input: { intentId: string; audit: ForgeAudit }): Promise<ForgeSnapshot> {
    const intent = await this.get({ id: input.intentId, tenantId: input.audit.tenantId });
    if (!intent) throw new ForgeLoopError('INTENT_NOT_FOUND');
    if (intent.status !== 'STAKED' && intent.status !== 'CONFIRMED') {
      throw new ForgeLoopError('SNAPSHOT_NOT_ALLOWED');
    }
    const judgments = await this.listJudgments({
      intentId: input.intentId,
      tenantId: input.audit.tenantId,
    });
    const judgmentsSummary = summarizeJudgments(judgments);
    const contentHash = hashSnapshotContent({
      statement: intent.statement,
      constraints: intent.constraints,
      frozen: intent.frozen,
      judgmentsSummary,
    });
    const snapshot = freezeSnapshot({
      id: snapshotIdFor(input.intentId, contentHash, input.audit.occurredAt),
      intentId: input.intentId,
      tenantId: input.audit.tenantId,
      statement: intent.statement,
      constraints: intent.constraints,
      frozen: intent.frozen,
      judgmentsSummary,
      contentHash,
      ...(intent.pxnTaskId ? { pxnTaskId: intent.pxnTaskId } : {}),
      createdAt: input.audit.occurredAt,
      createdBy: input.audit.actorId,
    });
    this.snapshots.set(snapshot.id, snapshot);
    const record = this.intents.get(input.intentId);
    if (record) {
      const ev = event('forge.intent.snapshot_taken', input.audit, {
        snapshotId: snapshot.id,
        contentHash: snapshot.contentHash,
        pxnTaskId: snapshot.pxnTaskId ?? null,
      });
      record.events.push(ev);
      record.view = Object.freeze({
        ...record.view,
        updatedAt: input.audit.occurredAt,
        events: Object.freeze([...record.events]),
      });
    }
    return snapshot;
  }

  async listSnapshots(input: {
    intentId: string;
    tenantId: string;
  }): Promise<readonly ForgeSnapshot[]> {
    const intent = await this.get({ id: input.intentId, tenantId: input.tenantId });
    if (!intent) throw new ForgeLoopError('INTENT_NOT_FOUND');
    return Object.freeze(
      [...this.snapshots.values()]
        .filter((item) => item.intentId === input.intentId && item.tenantId === input.tenantId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    );
  }

  async restoreSnapshot(input: {
    intentId: string;
    snapshotId: string;
    audit: ForgeAudit;
  }): Promise<ForgeIntent> {
    const record = this.intents.get(input.intentId);
    if (!record || record.view.tenantId !== input.audit.tenantId) {
      throw new ForgeLoopError('INTENT_NOT_FOUND');
    }
    if (record.view.status !== 'STAKED' && record.view.status !== 'CONFIRMED') {
      throw new ForgeLoopError('ROLLBACK_NOT_ALLOWED');
    }
    const snapshot = this.snapshots.get(input.snapshotId);
    if (!snapshot || snapshot.intentId !== input.intentId || snapshot.tenantId !== input.audit.tenantId) {
      throw new ForgeLoopError('SNAPSHOT_NOT_FOUND');
    }
    const previous = {
      statement: record.view.statement,
      constraints: record.view.constraints,
      frozen: record.view.frozen,
    };
    const ev = event('forge.intent.rolled_back', input.audit, {
      snapshotId: snapshot.id,
      contentHash: snapshot.contentHash,
      pxnTaskId: record.view.pxnTaskId ?? snapshot.pxnTaskId ?? null,
      previousStatement: previous.statement,
      restoredStatement: snapshot.statement,
    });
    record.events.push(ev);
    record.view = Object.freeze({
      ...record.view,
      statement: snapshot.statement,
      constraints: snapshot.constraints,
      frozen: snapshot.frozen,
      updatedAt: input.audit.occurredAt,
      events: Object.freeze([...record.events]),
    });
    return record.view;
  }

  private appendIntentEvent(
    intentId: string,
    audit: ForgeAudit,
    type: string,
    payload: Record<string, unknown>,
  ): void {
    const record = this.intents.get(intentId);
    if (!record) return;
    const ev = event(type, audit, payload);
    record.events.push(ev);
    record.view = Object.freeze({
      ...record.view,
      updatedAt: audit.occurredAt,
      events: Object.freeze([...record.events]),
    });
  }

  async createLifeform(input: {
    intentId: string;
    name?: string;
    audit: ForgeAudit;
  }): Promise<ForgeLifeform> {
    const intent = await this.get({ id: input.intentId, tenantId: input.audit.tenantId });
    if (!intent) throw new ForgeLoopError('INTENT_NOT_FOUND');
    if (intent.status !== 'SETTLED') throw new ForgeLoopError('LIFEFORM_REQUIRES_SETTLED');
    const id = lifeformIdFor(input.intentId);
    const existing = this.lifeforms.get(id);
    if (existing) return existing;
    const lifeform = freezeLifeform({
      id,
      intentId: input.intentId,
      tenantId: input.audit.tenantId,
      name: (input.name?.trim() || intent.statement.slice(0, 64) || input.intentId),
      status: 'ACTIVE',
      proposals: [],
      createdAt: input.audit.occurredAt,
      updatedAt: input.audit.occurredAt,
      createdBy: input.audit.actorId,
    });
    this.lifeforms.set(id, lifeform);
    this.appendIntentEvent(input.intentId, input.audit, 'forge.lifeform.created', {
      lifeformId: id,
      name: lifeform.name,
      status: lifeform.status,
    });
    return lifeform;
  }

  async listLifeforms(input: { tenantId: string }): Promise<readonly ForgeLifeform[]> {
    return Object.freeze(
      [...this.lifeforms.values()]
        .filter((item) => item.tenantId === input.tenantId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    );
  }

  async getLifeform(input: { id: string; tenantId: string }): Promise<ForgeLifeform | undefined> {
    const lifeform = this.lifeforms.get(input.id);
    if (!lifeform || lifeform.tenantId !== input.tenantId) return undefined;
    return lifeform;
  }

  async addLifeformProposal(input: {
    lifeformId: string;
    summary: string;
    audit: ForgeAudit;
  }): Promise<ForgeLifeform> {
    const lifeform = this.lifeforms.get(input.lifeformId);
    if (!lifeform || lifeform.tenantId !== input.audit.tenantId) {
      throw new ForgeLoopError('LIFEFORM_NOT_FOUND');
    }
    if (lifeform.status !== 'ACTIVE') throw new ForgeLoopError('LIFEFORM_NOT_ACTIVE');
    const summary = input.summary.trim();
    if (!summary) throw new ForgeLoopError('PROPOSAL_SUMMARY_REQUIRED');
    const proposal = freezeProposal({
      id: newProposalId(),
      summary,
      status: 'PENDING',
      createdAt: input.audit.occurredAt,
    });
    const next = freezeLifeform({
      ...lifeform,
      proposals: [...lifeform.proposals, proposal],
      updatedAt: input.audit.occurredAt,
    });
    this.lifeforms.set(next.id, next);
    this.appendIntentEvent(lifeform.intentId, input.audit, 'forge.lifeform.proposal_added', {
      lifeformId: next.id,
      proposalId: proposal.id,
      summary: proposal.summary,
    });
    return next;
  }

  async decideLifeformProposal(input: {
    lifeformId: string;
    proposalId: string;
    decision: 'ACCEPTED' | 'REJECTED';
    audit: ForgeAudit;
  }): Promise<ForgeLifeform> {
    const lifeform = this.lifeforms.get(input.lifeformId);
    if (!lifeform || lifeform.tenantId !== input.audit.tenantId) {
      throw new ForgeLoopError('LIFEFORM_NOT_FOUND');
    }
    if (lifeform.status !== 'ACTIVE') throw new ForgeLoopError('LIFEFORM_NOT_ACTIVE');
    const index = lifeform.proposals.findIndex((item) => item.id === input.proposalId);
    if (index < 0) throw new ForgeLoopError('PROPOSAL_NOT_FOUND');
    const current = lifeform.proposals[index]!;
    if (current.status !== 'PENDING') throw new ForgeLoopError('PROPOSAL_ALREADY_DECIDED');
    const decided = freezeProposal({
      ...current,
      status: input.decision,
      decidedAt: input.audit.occurredAt,
      decidedBy: input.audit.actorId,
    });
    const proposals = [...lifeform.proposals];
    proposals[index] = decided;
    const next = freezeLifeform({
      ...lifeform,
      proposals,
      updatedAt: input.audit.occurredAt,
    });
    this.lifeforms.set(next.id, next);
    this.appendIntentEvent(
      lifeform.intentId,
      input.audit,
      input.decision === 'ACCEPTED'
        ? 'forge.lifeform.proposal_accepted'
        : 'forge.lifeform.proposal_rejected',
      {
        lifeformId: next.id,
        proposalId: decided.id,
        decision: input.decision,
      },
    );
    return next;
  }

  async setLifeformStatus(input: {
    lifeformId: string;
    status: ForgeLifeformStatus;
    audit: ForgeAudit;
  }): Promise<ForgeLifeform> {
    const lifeform = this.lifeforms.get(input.lifeformId);
    if (!lifeform || lifeform.tenantId !== input.audit.tenantId) {
      throw new ForgeLoopError('LIFEFORM_NOT_FOUND');
    }
    if (lifeform.status === 'TERMINATED') throw new ForgeLoopError('LIFEFORM_TERMINATED');
    if (input.status === lifeform.status) return lifeform;
    if (input.status === 'ACTIVE' && lifeform.status !== 'FROZEN') {
      throw new ForgeLoopError('LIFEFORM_STATUS_INVALID');
    }
    if (input.status === 'FROZEN' && lifeform.status !== 'ACTIVE') {
      throw new ForgeLoopError('LIFEFORM_STATUS_INVALID');
    }
    const next = freezeLifeform({
      ...lifeform,
      status: input.status,
      updatedAt: input.audit.occurredAt,
    });
    this.lifeforms.set(next.id, next);
    const type = input.status === 'FROZEN'
      ? 'forge.lifeform.frozen'
      : input.status === 'ACTIVE'
        ? 'forge.lifeform.unfrozen'
        : 'forge.lifeform.terminated';
    this.appendIntentEvent(lifeform.intentId, input.audit, type, {
      lifeformId: next.id,
      status: next.status,
    });
    return next;
  }
}

export function newForgeIntentId(): string {
  return `forge:${randomUUID()}`;
}

export function snapshotIntent(intent: ForgeIntent): ForgeIntent {
  return immutableJsonCopy(intent);
}
