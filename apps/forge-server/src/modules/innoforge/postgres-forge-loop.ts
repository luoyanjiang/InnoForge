import type { Pool } from 'pg';

import type { ExternalJob } from '../../../../../packages/adapters/src/external-adapter.js';
import { immutableJsonCopy } from '../../../../../packages/domain/src/canonical-json.js';
import { ExternalAdapterRegistry } from './external-registry.js';
import {
  constraintsEqual,
  legacyConstraintsFromStatement,
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
  type ForgeJudgmentAction,
  type ForgeVariantCandidate,
} from './forge-judgments.js';
import {
  ForgeLoopError,
  type CreditAccount,
  type ForgeAudit,
  type ForgeEvent,
  type ForgeIntent,
  type ForgeLoopService,
  type ForgeLoopStatus,
  type ForgeTimelineItem,
  type ForgeCreditAllocation,
  type ForgeAllocationWeights,
  type ForgeReputation,
  type ForgeSnapshot,
  DEFAULT_ALLOCATION_WEIGHTS,
} from './forge-loop.js';
import {
  createPxnBridge,
  type ForgePxnBridge,
  type ForgePxnPath,
} from './pxn-bridge.js';
import { buildTimeline } from './forge-timeline.js';
import {
  allocationAmountsByPrincipal,
  computeCreditAllocations,
  type ForgeAllocationRole,
} from './forge-allocations.js';
import {
  buildReputation,
  computeReputationScore,
} from './forge-reputation.js';
import {
  freezeSnapshot,
  hashSnapshotContent,
  snapshotIdFor,
  summarizeJudgments,
  type ForgeSnapshotJudgmentSummary,
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
import {
  constraintFromMemory,
  freezeMemory,
  newMemoryId,
  type ForgeMemory,
  type ForgeMemoryStatus,
} from './forge-memories.js';

type JudgmentRow = {
  id: string;
  intent_id: string;
  tenant_id: string;
  actor_id: string;
  candidate_id: string;
  action: ForgeJudgmentAction;
  rationale: string | null;
  impact: string | null;
  candidate_snapshot: ForgeVariantCandidate;
  occurred_at: Date;
};

type IntentRow = {
  id: string;
  tenant_id: string;
  principal_id: string;
  statement: string;
  constraints: ForgeConstraint[] | null;
  frozen: boolean | null;
  stake: string;
  status: ForgeLoopStatus;
  adapter_id: string;
  pxn_task_id: string | null;
  pxn_path: ForgePxnPath | null;
  deploy_job_id: string | null;
  deploy_job: ExternalJob | null;
  credit_minted: string | null;
  created_at: Date;
  updated_at: Date;
  confirmed_at: Date | null;
  settled_at: Date | null;
};

type EventRow = {
  id: string;
  event_type: string;
  occurred_at: Date;
  actor_id: string;
  payload: Record<string, unknown>;
};

/**
 * PostgreSQL-backed forge loop. Adapter job state remains in the in-process
 * ExternalAdapterRegistry (simulator); durable intent/credit state is in DB.
 * PXN robot path uses createPxnBridge() (Sim by default; Http when PXN_BASE_URL set).
 */
export class PostgresForgeLoopService implements ForgeLoopService {
  private readonly bridge: ForgePxnBridge;

  constructor(
    private readonly pool: Pool,
    private readonly registry = new ExternalAdapterRegistry(),
    bridge?: ForgePxnBridge,
  ) {
    this.bridge = bridge ?? createPxnBridge();
  }

  async ensureAccount(input: {
    tenantId: string;
    principalId: string;
    openingBalance?: number;
  }): Promise<CreditAccount> {
    await this.pool.query(
      `INSERT INTO forge_credit_accounts (tenant_id, principal_id, balance, staked, updated_at)
       VALUES ($1,$2,$3,0,now())
       ON CONFLICT (tenant_id, principal_id) DO NOTHING`,
      [input.tenantId, input.principalId, input.openingBalance ?? 1000],
    );
    const account = await this.getAccount(input);
    if (!account) throw new ForgeLoopError('ACCOUNT_NOT_FOUND');
    return account;
  }

  private async reputationFor(tenantId: string, principalId: string): Promise<ForgeReputation> {
    const result = await this.pool.query<{
      actor_id: string;
      action: 'ADOPT' | 'REJECT';
      intent_status: string;
    }>(
      `SELECT j.actor_id, j.action, i.status AS intent_status
         FROM forge_judgments j
         JOIN forge_intents i ON i.id = j.intent_id
        WHERE j.tenant_id = $1`,
      [tenantId],
    );
    const countsByPrincipal = new Map<string, { adoptSettled: number; rejects: number }>();
    for (const row of result.rows) {
      const current = countsByPrincipal.get(row.actor_id) ?? { adoptSettled: 0, rejects: 0 };
      if (row.action === 'REJECT') current.rejects += 1;
      if (row.action === 'ADOPT' && row.intent_status === 'SETTLED') current.adoptSettled += 1;
      countsByPrincipal.set(row.actor_id, current);
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

  async getAccount(input: { tenantId: string; principalId: string }): Promise<CreditAccount | undefined> {
    const result = await this.pool.query<{ balance: string; staked: string }>(
      `SELECT balance::text, staked::text FROM forge_credit_accounts
        WHERE tenant_id=$1 AND principal_id=$2`,
      [input.tenantId, input.principalId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return Object.freeze({
      tenantId: input.tenantId,
      principalId: input.principalId,
      balance: Number(row.balance),
      staked: Number(row.staked),
      reputation: await this.reputationFor(input.tenantId, input.principalId),
    });
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
    await this.pool.query(
      `UPDATE forge_credit_accounts
          SET balance = balance + $3, updated_at = $4::timestamptz
        WHERE tenant_id=$1 AND principal_id=$2`,
      [input.tenantId, input.principalId, input.amount, input.audit.occurredAt],
    );
    const account = await this.getAccount({ tenantId: input.tenantId, principalId: input.principalId });
    if (!account) throw new ForgeLoopError('ACCOUNT_NOT_FOUND');
    return account;
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
    if (!(input.stake > 0) || !Number.isFinite(input.stake)) throw new ForgeLoopError('STAKE_INVALID');
    if (!input.statement.trim()) throw new ForgeLoopError('STATEMENT_REQUIRED');
    const constraints = normalizeConstraints(input.constraints);
    const existing = await this.get({ id: input.id, tenantId: input.audit.tenantId });
    if (existing) {
      if (
        existing.statement !== input.statement.trim()
        || existing.stake !== input.stake
        || !constraintsEqual(existing.constraints, constraints)
      ) {
        throw new ForgeLoopError('INTENT_REPLACEMENT_DENIED');
      }
      return existing;
    }
    const adapterId = input.adapterId ?? 'mfg-fab';
    if (!this.registry.get(adapterId)) throw new ForgeLoopError('ADAPTER_NOT_FOUND');
    const pxnPath = await this.bridge.attachOnCreate({
      intentId: input.id,
      statement: input.statement.trim(),
      stake: input.stake,
      adapterId,
      ...(input.pxnTaskId ? { existingTaskId: input.pxnTaskId } : {}),
      audit: input.audit,
    });
    await this.ensureAccount({ tenantId: input.audit.tenantId, principalId: input.audit.actorId });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<{ balance: string; staked: string }>(
        `SELECT balance::text, staked::text FROM forge_credit_accounts
          WHERE tenant_id=$1 AND principal_id=$2 FOR UPDATE`,
        [input.audit.tenantId, input.audit.actorId],
      );
      const balance = Number(locked.rows[0]?.balance ?? 0);
      if (balance < input.stake) throw new ForgeLoopError('INSUFFICIENT_CREDIT');
      await client.query(
        `UPDATE forge_credit_accounts
            SET balance = balance - $3, staked = staked + $3, updated_at = $4::timestamptz
          WHERE tenant_id=$1 AND principal_id=$2`,
        [input.audit.tenantId, input.audit.actorId, input.stake, input.audit.occurredAt],
      );
      await client.query(
        `INSERT INTO forge_intents
          (id, tenant_id, principal_id, statement, constraints, frozen, stake, status, adapter_id,
           pxn_task_id, pxn_path, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,false,$6,'STAKED',$7,$8,$9::jsonb,$10::timestamptz,$10::timestamptz)`,
        [
          input.id,
          input.audit.tenantId,
          input.audit.actorId,
          input.statement.trim(),
          JSON.stringify(constraints),
          input.stake,
          adapterId,
          pxnPath.taskId,
          JSON.stringify(pxnPath),
          input.audit.occurredAt,
        ],
      );
      const payload = {
        stake: input.stake,
        adapterId,
        balanceAfter: balance - input.stake,
        pxnTaskId: pxnPath.taskId,
        pxnTaskState: pxnPath.taskState ?? null,
        constraints,
      };
      await this.insertEvent(client, input.id, 'forge.intent.staked', input.audit, payload);
      await this.appendDomainEvent(client, input.id, 'forge.intent.staked', input.audit, payload);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const created = await this.get({ id: input.id, tenantId: input.audit.tenantId });
    if (!created) throw new ForgeLoopError('INTENT_NOT_FOUND');
    return created;
  }

  async updateIntent(input: {
    id: string;
    statement?: string;
    constraints?: readonly ForgeConstraint[] | unknown;
    frozen?: boolean;
    audit: ForgeAudit;
  }): Promise<ForgeIntent> {
    const current = await this.requireIntent(input.id, input.audit.tenantId);
    if (current.status !== 'STAKED' && current.status !== 'CONFIRMED') {
      throw new ForgeLoopError('INTENT_NOT_EDITABLE');
    }
    const nextFrozen = input.frozen !== undefined ? Boolean(input.frozen) : current.frozen;
    const wantsContent = input.statement !== undefined || input.constraints !== undefined;
    if (wantsContent && current.frozen && input.frozen !== false) {
      throw new ForgeLoopError('INTENT_FROZEN');
    }
    const nextStatement = input.statement !== undefined
      ? input.statement.trim()
      : current.statement;
    if (!nextStatement) throw new ForgeLoopError('STATEMENT_REQUIRED');
    const nextConstraints = input.constraints !== undefined
      ? normalizeConstraints(input.constraints)
      : current.constraints;
    const contentChanged =
      nextStatement !== current.statement
      || !constraintsEqual(nextConstraints, current.constraints);
    const freezeChanged = nextFrozen !== current.frozen;
    if (!contentChanged && !freezeChanged) return current;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE forge_intents
            SET statement=$2, constraints=$3::jsonb, frozen=$4, updated_at=$5::timestamptz
          WHERE id=$1 AND tenant_id=$6`,
        [
          input.id,
          nextStatement,
          JSON.stringify(nextConstraints),
          nextFrozen,
          input.audit.occurredAt,
          input.audit.tenantId,
        ],
      );
      if (contentChanged) {
        const payload = { statement: nextStatement, constraints: nextConstraints };
        await this.insertEvent(client, input.id, 'forge.intent.updated', input.audit, payload);
        await this.appendDomainEvent(client, input.id, 'forge.intent.updated', input.audit, payload);
      }
      if (freezeChanged) {
        const type = nextFrozen ? 'forge.intent.frozen' : 'forge.intent.unfrozen';
        const payload = { frozen: nextFrozen };
        await this.insertEvent(client, input.id, type, input.audit, payload);
        await this.appendDomainEvent(client, input.id, type, input.audit, payload);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return this.requireIntent(input.id, input.audit.tenantId);
  }

  async confirm(input: { id: string; audit: ForgeAudit }): Promise<ForgeIntent> {
    const current = await this.requireIntent(input.id, input.audit.tenantId);
    if (current.status === 'CONFIRMED' || current.status === 'DEPLOYING'
      || current.status === 'FEEDBACK' || current.status === 'SETTLED') {
      return current;
    }
    if (current.status !== 'STAKED') throw new ForgeLoopError('INTENT_NOT_CONFIRMABLE');
    const basePath = current.pxnPath ?? (current.pxnTaskId
      ? Object.freeze({ taskId: current.pxnTaskId, mode: 'bridged' as const })
      : undefined);
    if (!basePath) throw new ForgeLoopError('PXN_PATH_REQUIRED');
    const pxnPath = await this.bridge.confirmViaApprovals({
      intentId: current.id,
      path: basePath,
      audit: input.audit,
    });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE forge_intents
            SET status='CONFIRMED', confirmed_at=$2::timestamptz, updated_at=$2::timestamptz,
                pxn_task_id=$3, pxn_path=$4::jsonb
          WHERE id=$1 AND status='STAKED'`,
        [input.id, input.audit.occurredAt, pxnPath.taskId, JSON.stringify(pxnPath)],
      );
      const payload = {
        previousStatus: current.status,
        pxnTaskId: pxnPath.taskId,
        approvalId: pxnPath.approvalId ?? null,
        pxnTaskState: pxnPath.taskState ?? null,
      };
      await this.insertEvent(client, input.id, 'forge.intent.confirmed', input.audit, payload);
      await this.appendDomainEvent(client, input.id, 'forge.intent.confirmed', input.audit, payload);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return this.requireIntent(input.id, input.audit.tenantId);
  }

  async deploy(input: { id: string; audit: ForgeAudit }): Promise<ForgeIntent> {
    const current = await this.requireIntent(input.id, input.audit.tenantId);
    if (current.status === 'DEPLOYING' || current.status === 'FEEDBACK' || current.status === 'SETTLED') {
      return current;
    }
    if (current.status !== 'CONFIRMED') throw new ForgeLoopError('CONFIRMATION_REQUIRED');
    const adapter = this.registry.get(current.adapterId);
    if (!adapter) throw new ForgeLoopError('ADAPTER_NOT_FOUND');
    const jobId = current.deployJobId ?? `job:${current.id}`;
    const job = await adapter.createJob({
      jobId,
      at: input.audit.occurredAt,
      payload: {
        intentId: current.id,
        statement: current.statement,
        stake: current.stake,
        pxnTaskId: current.pxnTaskId ?? null,
        gateway: 'pxn.innoforge.deploy',
      },
    });
    const basePath = current.pxnPath ?? (current.pxnTaskId
      ? Object.freeze({ taskId: current.pxnTaskId, mode: 'bridged' as const })
      : undefined);
    if (!basePath) throw new ForgeLoopError('PXN_PATH_REQUIRED');
    const pxnPath = await this.bridge.recordDeployPath({
      intentId: current.id,
      path: basePath,
      deployJobId: job.jobId,
      adapterId: adapter.adapterId,
      audit: input.audit,
    });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE forge_intents
            SET status='DEPLOYING', deploy_job_id=$2, deploy_job=$3::jsonb, updated_at=$4::timestamptz,
                pxn_path=$5::jsonb
          WHERE id=$1 AND status='CONFIRMED'`,
        [input.id, job.jobId, JSON.stringify(job), input.audit.occurredAt, JSON.stringify(pxnPath)],
      );
      const payload = {
        jobId: job.jobId,
        adapterId: adapter.adapterId,
        pxnDispatchId: pxnPath.dispatchId ?? null,
        pxnEvidencePackageId: pxnPath.evidencePackageId ?? null,
        pxnTaskState: pxnPath.taskState ?? null,
      };
      await this.insertEvent(client, input.id, 'forge.deploy.started', input.audit, payload);
      await this.appendDomainEvent(client, input.id, 'forge.deploy.started', input.audit, payload);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return this.requireIntent(input.id, input.audit.tenantId);
  }

  async feedback(input: { id: string; audit: ForgeAudit }): Promise<ForgeIntent> {
    const current = await this.requireIntent(input.id, input.audit.tenantId);
    if (current.status === 'SETTLED') return current;
    if (current.status !== 'DEPLOYING' && current.status !== 'FEEDBACK') {
      throw new ForgeLoopError('DEPLOY_REQUIRED');
    }
    const adapter = this.registry.get(current.adapterId);
    if (!adapter || !current.deployJobId) throw new ForgeLoopError('DEPLOY_JOB_MISSING');
    const job = adapter.tick
      ? await adapter.tick(current.deployJobId, input.audit.occurredAt)
      : await adapter.getJob(current.deployJobId);
    if (!job) throw new ForgeLoopError('DEPLOY_JOB_MISSING');

    const basePath = current.pxnPath ?? (current.pxnTaskId
      ? Object.freeze({ taskId: current.pxnTaskId, mode: 'bridged' as const })
      : undefined);
    if (!basePath) throw new ForgeLoopError('PXN_PATH_REQUIRED');
    const willSettle = job.status === 'SUCCEEDED';
    const pxnPath = await this.bridge.recordFeedbackPath({
      intentId: current.id,
      path: basePath,
      jobStatus: job.status,
      settled: willSettle,
      audit: input.audit,
    });

    const minted = willSettle ? Math.round(current.stake * 1.5) : 0;
    let allocations: readonly ForgeCreditAllocation[] = [];
    if (willSettle) {
      const judgments = await this.listJudgments({
        intentId: current.id,
        tenantId: current.tenantId,
      });
      const confirmed = [...current.events].reverse()
        .find((item) => item.type === 'forge.intent.confirmed');
      allocations = computeCreditAllocations({
        intentId: current.id,
        tenantId: current.tenantId,
        minted,
        proposerId: current.principalId,
        suggesterIds: judgments.filter((item) => item.action === 'ADOPT').map((item) => item.actorId),
        confirmerId: confirmed?.actorId ?? current.principalId,
        occurredAt: input.audit.occurredAt,
      });
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.insertEvent(client, input.id, 'forge.feedback.tick', input.audit, {
        jobId: job.jobId,
        status: job.status,
        pxnTaskState: pxnPath.taskState ?? null,
        ...(job.result ? { result: job.result } : {}),
      });
      if (!willSettle) {
        await client.query(
          `UPDATE forge_intents
              SET status='FEEDBACK', deploy_job=$2::jsonb, updated_at=$3::timestamptz, pxn_path=$4::jsonb
            WHERE id=$1`,
          [input.id, JSON.stringify(job), input.audit.occurredAt, JSON.stringify(pxnPath)],
        );
        await client.query('COMMIT');
        return this.requireIntent(input.id, input.audit.tenantId);
      }
      await client.query(
        `UPDATE forge_credit_accounts
            SET staked = staked - $3, updated_at = $4::timestamptz
          WHERE tenant_id=$1 AND principal_id=$2`,
        [current.tenantId, current.principalId, current.stake, input.audit.occurredAt],
      );
      const byPrincipal = allocationAmountsByPrincipal(allocations);
      for (const [principalId, amount] of byPrincipal) {
        await client.query(
          `INSERT INTO forge_credit_accounts (tenant_id, principal_id, balance, staked, updated_at)
           VALUES ($1,$2,$3,0,$4::timestamptz)
           ON CONFLICT (tenant_id, principal_id) DO UPDATE
             SET balance = forge_credit_accounts.balance + EXCLUDED.balance,
                 updated_at = EXCLUDED.updated_at`,
          [current.tenantId, principalId, amount, input.audit.occurredAt],
        );
      }
      for (const allocation of allocations) {
        await client.query(
          `INSERT INTO forge_credit_allocations
            (id, intent_id, tenant_id, principal_id, role, weight_percent, amount, occurred_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz)`,
          [
            allocation.id,
            allocation.intentId,
            allocation.tenantId,
            allocation.principalId,
            allocation.role,
            allocation.weightPercent,
            allocation.amount,
            allocation.occurredAt,
          ],
        );
      }
      await client.query(
        `UPDATE forge_intents
            SET status='SETTLED', deploy_job=$2::jsonb, credit_minted=$3,
                settled_at=$4::timestamptz, updated_at=$4::timestamptz, pxn_path=$5::jsonb
          WHERE id=$1`,
        [input.id, JSON.stringify(job), minted, input.audit.occurredAt, JSON.stringify(pxnPath)],
      );
      const settlePayload = {
        minted,
        stakeReturnedAs: current.stake,
        reward: minted - current.stake,
        allocations: allocations.map((item) => ({
          role: item.role,
          principalId: item.principalId,
          amount: item.amount,
          weightPercent: item.weightPercent,
        })),
        pxnAcceptanceId: pxnPath.acceptanceId ?? null,
        pxnTaskState: pxnPath.taskState ?? null,
      };
      await this.insertEvent(client, input.id, 'forge.credit.settled', input.audit, settlePayload);
      await this.appendDomainEvent(client, input.id, 'forge.credit.settled', input.audit, settlePayload);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return this.requireIntent(input.id, input.audit.tenantId);
  }

  async get(input: { id: string; tenantId: string }): Promise<ForgeIntent | undefined> {
    const result = await this.pool.query<IntentRow>(
      `SELECT * FROM forge_intents WHERE id=$1 AND tenant_id=$2`,
      [input.id, input.tenantId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const events = await this.pool.query<EventRow>(
      `SELECT id, event_type, occurred_at, actor_id, payload
         FROM forge_intent_events WHERE intent_id=$1 ORDER BY occurred_at, id`,
      [input.id],
    );
    return this.toView(row, events.rows);
  }

  async listIntents(input: { tenantId: string }): Promise<readonly ForgeIntent[]> {
    const result = await this.pool.query<IntentRow>(
      `SELECT * FROM forge_intents WHERE tenant_id=$1 ORDER BY updated_at DESC, id`,
      [input.tenantId],
    );
    const intents: ForgeIntent[] = [];
    for (const row of result.rows) {
      const events = await this.pool.query<EventRow>(
        `SELECT id, event_type, occurred_at, actor_id, payload
           FROM forge_intent_events WHERE intent_id=$1 ORDER BY occurred_at, id`,
        [row.id],
      );
      intents.push(this.toView(row, events.rows));
    }
    return intents;
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
    await this.requireIntent(input.intentId, input.tenantId);
    const result = await this.pool.query<JudgmentRow>(
      `SELECT * FROM forge_judgments
        WHERE intent_id=$1 AND tenant_id=$2
        ORDER BY occurred_at DESC, id`,
      [input.intentId, input.tenantId],
    );
    return result.rows.map((row) => this.judgmentToView(row));
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
    await this.requireIntent(input.intentId, input.tenantId);
    const result = await this.pool.query<{
      id: string;
      intent_id: string;
      tenant_id: string;
      principal_id: string;
      role: ForgeAllocationRole;
      weight_percent: string;
      amount: string;
      occurred_at: Date;
    }>(
      `SELECT * FROM forge_credit_allocations
        WHERE intent_id=$1 AND tenant_id=$2
        ORDER BY role, principal_id`,
      [input.intentId, input.tenantId],
    );
    return result.rows.map((row) => Object.freeze({
      id: row.id,
      intentId: row.intent_id,
      tenantId: row.tenant_id,
      principalId: row.principal_id,
      role: row.role,
      weightPercent: Number(row.weight_percent),
      amount: Number(row.amount),
      occurredAt: new Date(row.occurred_at).toISOString(),
    }));
  }

  private snapshotFromRow(row: {
    id: string;
    intent_id: string;
    tenant_id: string;
    statement: string;
    constraints: ForgeConstraint[];
    frozen: boolean;
    judgments_summary: ForgeSnapshotJudgmentSummary[];
    content_hash: string;
    pxn_task_id: string | null;
    created_at: Date;
    created_by: string;
  }): ForgeSnapshot {
    return freezeSnapshot({
      id: row.id,
      intentId: row.intent_id,
      tenantId: row.tenant_id,
      statement: row.statement,
      constraints: normalizeConstraints(row.constraints),
      frozen: row.frozen,
      judgmentsSummary: Object.freeze([...row.judgments_summary]),
      contentHash: row.content_hash,
      ...(row.pxn_task_id ? { pxnTaskId: row.pxn_task_id } : {}),
      createdAt: new Date(row.created_at).toISOString(),
      createdBy: row.created_by,
    });
  }

  async createSnapshot(input: { intentId: string; audit: ForgeAudit }): Promise<ForgeSnapshot> {
    const intent = await this.requireIntent(input.intentId, input.audit.tenantId);
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
    const id = snapshotIdFor(input.intentId, contentHash, input.audit.occurredAt);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO forge_snapshots
          (id, intent_id, tenant_id, statement, constraints, frozen, judgments_summary,
           content_hash, pxn_task_id, created_at, created_by)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8,$9,$10::timestamptz,$11)`,
        [
          id,
          input.intentId,
          input.audit.tenantId,
          intent.statement,
          JSON.stringify(intent.constraints),
          intent.frozen,
          JSON.stringify(judgmentsSummary),
          contentHash,
          intent.pxnTaskId ?? null,
          input.audit.occurredAt,
          input.audit.actorId,
        ],
      );
      const payload = {
        snapshotId: id,
        contentHash,
        pxnTaskId: intent.pxnTaskId ?? null,
      };
      await this.insertEvent(client, input.intentId, 'forge.intent.snapshot_taken', input.audit, payload);
      await this.appendDomainEvent(client, input.intentId, 'forge.intent.snapshot_taken', input.audit, payload);
      await client.query(
        `UPDATE forge_intents SET updated_at=$2::timestamptz WHERE id=$1`,
        [input.intentId, input.audit.occurredAt],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const created = await this.pool.query(
      `SELECT * FROM forge_snapshots WHERE id=$1`,
      [id],
    );
    if (!created.rows[0]) throw new ForgeLoopError('SNAPSHOT_NOT_FOUND');
    return this.snapshotFromRow(created.rows[0]);
  }

  async listSnapshots(input: {
    intentId: string;
    tenantId: string;
  }): Promise<readonly ForgeSnapshot[]> {
    await this.requireIntent(input.intentId, input.tenantId);
    const result = await this.pool.query(
      `SELECT * FROM forge_snapshots
        WHERE intent_id=$1 AND tenant_id=$2
        ORDER BY created_at DESC, id`,
      [input.intentId, input.tenantId],
    );
    return result.rows.map((row) => this.snapshotFromRow(row));
  }

  async restoreSnapshot(input: {
    intentId: string;
    snapshotId: string;
    audit: ForgeAudit;
  }): Promise<ForgeIntent> {
    const intent = await this.requireIntent(input.intentId, input.audit.tenantId);
    if (intent.status !== 'STAKED' && intent.status !== 'CONFIRMED') {
      throw new ForgeLoopError('ROLLBACK_NOT_ALLOWED');
    }
    const snapResult = await this.pool.query(
      `SELECT * FROM forge_snapshots WHERE id=$1 AND intent_id=$2 AND tenant_id=$3`,
      [input.snapshotId, input.intentId, input.audit.tenantId],
    );
    if (!snapResult.rows[0]) throw new ForgeLoopError('SNAPSHOT_NOT_FOUND');
    const snapshot = this.snapshotFromRow(snapResult.rows[0]);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE forge_intents
            SET statement=$2, constraints=$3::jsonb, frozen=$4, updated_at=$5::timestamptz
          WHERE id=$1`,
        [
          input.intentId,
          snapshot.statement,
          JSON.stringify(snapshot.constraints),
          snapshot.frozen,
          input.audit.occurredAt,
        ],
      );
      const payload = {
        snapshotId: snapshot.id,
        contentHash: snapshot.contentHash,
        pxnTaskId: intent.pxnTaskId ?? snapshot.pxnTaskId ?? null,
        previousStatement: intent.statement,
        restoredStatement: snapshot.statement,
      };
      await this.insertEvent(client, input.intentId, 'forge.intent.rolled_back', input.audit, payload);
      await this.appendDomainEvent(client, input.intentId, 'forge.intent.rolled_back', input.audit, payload);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return this.requireIntent(input.intentId, input.audit.tenantId);
  }

  async recordJudgment(input: {
    intentId: string;
    candidateId: string;
    action: string;
    rationale?: string;
    impact?: string;
    audit: ForgeAudit;
  }): Promise<ForgeJudgment> {
    await this.requireIntent(input.intentId, input.audit.tenantId);
    const action = normalizeJudgmentAction(input.action);
    const candidate = findCandidate(input.candidateId);
    const id = judgmentIdFor(input.intentId, input.candidateId);
    const existing = await this.pool.query<JudgmentRow>(
      `SELECT * FROM forge_judgments WHERE id=$1`,
      [id],
    );
    if (existing.rows[0]) {
      const view = this.judgmentToView(existing.rows[0]);
      if (view.action !== action) throw new ForgeLoopError('JUDGMENT_ALREADY_RECORDED');
      return view;
    }

    const rationale = input.rationale?.trim() || null;
    const impact = input.impact?.trim() || candidate.impact;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO forge_judgments
          (id, intent_id, tenant_id, actor_id, candidate_id, action, rationale, impact,
           candidate_snapshot, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::timestamptz)`,
        [
          id,
          input.intentId,
          input.audit.tenantId,
          input.audit.actorId,
          candidate.id,
          action,
          rationale,
          impact,
          JSON.stringify(candidate),
          input.audit.occurredAt,
        ],
      );
      await client.query(
        `UPDATE forge_intents SET updated_at=$2::timestamptz WHERE id=$1`,
        [input.intentId, input.audit.occurredAt],
      );
      const payload = {
        judgmentId: id,
        candidateId: candidate.id,
        action,
        actorId: input.audit.actorId,
        impact,
        ...(rationale ? { rationale } : {}),
      };
      await this.insertEvent(client, input.intentId, 'forge.judgment.recorded', input.audit, payload);
      await this.appendDomainEvent(client, input.intentId, 'forge.judgment.recorded', input.audit, payload);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const created = await this.pool.query<JudgmentRow>(`SELECT * FROM forge_judgments WHERE id=$1`, [id]);
    if (!created.rows[0]) throw new ForgeLoopError('JUDGMENT_NOT_FOUND');
    return this.judgmentToView(created.rows[0]);
  }

  private judgmentToView(row: JudgmentRow): ForgeJudgment {
    return freezeJudgment({
      id: row.id,
      intentId: row.intent_id,
      tenantId: row.tenant_id,
      actorId: row.actor_id,
      candidateId: row.candidate_id,
      action: row.action,
      ...(row.rationale ? { rationale: row.rationale } : {}),
      ...(row.impact ? { impact: row.impact } : {}),
      candidateSnapshot: immutableJsonCopy(row.candidate_snapshot),
      occurredAt: new Date(row.occurred_at).toISOString(),
    });
  }

  private lifeformFromRow(row: {
    id: string;
    intent_id: string;
    tenant_id: string;
    name: string;
    status: ForgeLifeformStatus;
    proposals: ForgeLifeformProposal[] | null;
    created_at: Date;
    updated_at: Date;
    created_by: string;
  }): ForgeLifeform {
    const proposals = Array.isArray(row.proposals)
      ? row.proposals.map((item) => freezeProposal(item))
      : [];
    return freezeLifeform({
      id: row.id,
      intentId: row.intent_id,
      tenantId: row.tenant_id,
      name: row.name,
      status: row.status,
      proposals,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      createdBy: row.created_by,
    });
  }

  async createLifeform(input: {
    intentId: string;
    name?: string;
    audit: ForgeAudit;
  }): Promise<ForgeLifeform> {
    const intent = await this.requireIntent(input.intentId, input.audit.tenantId);
    if (intent.status !== 'SETTLED') throw new ForgeLoopError('LIFEFORM_REQUIRES_SETTLED');
    const id = lifeformIdFor(input.intentId);
    const existing = await this.pool.query(
      `SELECT * FROM forge_lifeforms WHERE id=$1`,
      [id],
    );
    if (existing.rows[0]) return this.lifeformFromRow(existing.rows[0]);
    const name = (input.name?.trim() || intent.statement.slice(0, 64) || input.intentId);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO forge_lifeforms
          (id, intent_id, tenant_id, name, status, proposals, created_at, updated_at, created_by)
         VALUES ($1,$2,$3,$4,'ACTIVE','[]'::jsonb,$5::timestamptz,$5::timestamptz,$6)`,
        [
          id,
          input.intentId,
          input.audit.tenantId,
          name,
          input.audit.occurredAt,
          input.audit.actorId,
        ],
      );
      const payload = { lifeformId: id, name, status: 'ACTIVE' };
      await this.insertEvent(client, input.intentId, 'forge.lifeform.created', input.audit, payload);
      await this.appendDomainEvent(client, input.intentId, 'forge.lifeform.created', input.audit, payload);
      await client.query(
        `UPDATE forge_intents SET updated_at=$2::timestamptz WHERE id=$1`,
        [input.intentId, input.audit.occurredAt],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const created = await this.pool.query(`SELECT * FROM forge_lifeforms WHERE id=$1`, [id]);
    if (!created.rows[0]) throw new ForgeLoopError('LIFEFORM_NOT_FOUND');
    return this.lifeformFromRow(created.rows[0]);
  }

  async listLifeforms(input: { tenantId: string }): Promise<readonly ForgeLifeform[]> {
    const result = await this.pool.query(
      `SELECT * FROM forge_lifeforms
        WHERE tenant_id=$1
        ORDER BY updated_at DESC, id`,
      [input.tenantId],
    );
    return Object.freeze(result.rows.map((row) => this.lifeformFromRow(row)));
  }

  async getLifeform(input: { id: string; tenantId: string }): Promise<ForgeLifeform | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM forge_lifeforms WHERE id=$1 AND tenant_id=$2`,
      [input.id, input.tenantId],
    );
    if (!result.rows[0]) return undefined;
    return this.lifeformFromRow(result.rows[0]);
  }

  async addLifeformProposal(input: {
    lifeformId: string;
    summary: string;
    audit: ForgeAudit;
  }): Promise<ForgeLifeform> {
    const lifeform = await this.getLifeform({
      id: input.lifeformId,
      tenantId: input.audit.tenantId,
    });
    if (!lifeform) throw new ForgeLoopError('LIFEFORM_NOT_FOUND');
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
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE forge_lifeforms
            SET proposals=$2::jsonb, updated_at=$3::timestamptz
          WHERE id=$1`,
        [next.id, JSON.stringify(next.proposals), input.audit.occurredAt],
      );
      const payload = {
        lifeformId: next.id,
        proposalId: proposal.id,
        summary: proposal.summary,
      };
      await this.insertEvent(client, lifeform.intentId, 'forge.lifeform.proposal_added', input.audit, payload);
      await this.appendDomainEvent(client, lifeform.intentId, 'forge.lifeform.proposal_added', input.audit, payload);
      await client.query(
        `UPDATE forge_intents SET updated_at=$2::timestamptz WHERE id=$1`,
        [lifeform.intentId, input.audit.occurredAt],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return next;
  }

  async decideLifeformProposal(input: {
    lifeformId: string;
    proposalId: string;
    decision: 'ACCEPTED' | 'REJECTED';
    audit: ForgeAudit;
  }): Promise<ForgeLifeform> {
    const lifeform = await this.getLifeform({
      id: input.lifeformId,
      tenantId: input.audit.tenantId,
    });
    if (!lifeform) throw new ForgeLoopError('LIFEFORM_NOT_FOUND');
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
    const eventType = input.decision === 'ACCEPTED'
      ? 'forge.lifeform.proposal_accepted'
      : 'forge.lifeform.proposal_rejected';
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE forge_lifeforms
            SET proposals=$2::jsonb, updated_at=$3::timestamptz
          WHERE id=$1`,
        [next.id, JSON.stringify(next.proposals), input.audit.occurredAt],
      );
      const payload = {
        lifeformId: next.id,
        proposalId: decided.id,
        decision: input.decision,
      };
      await this.insertEvent(client, lifeform.intentId, eventType, input.audit, payload);
      await this.appendDomainEvent(client, lifeform.intentId, eventType, input.audit, payload);
      await client.query(
        `UPDATE forge_intents SET updated_at=$2::timestamptz WHERE id=$1`,
        [lifeform.intentId, input.audit.occurredAt],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return next;
  }

  async setLifeformStatus(input: {
    lifeformId: string;
    status: ForgeLifeformStatus;
    audit: ForgeAudit;
  }): Promise<ForgeLifeform> {
    const lifeform = await this.getLifeform({
      id: input.lifeformId,
      tenantId: input.audit.tenantId,
    });
    if (!lifeform) throw new ForgeLoopError('LIFEFORM_NOT_FOUND');
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
    const eventType = input.status === 'FROZEN'
      ? 'forge.lifeform.frozen'
      : input.status === 'ACTIVE'
        ? 'forge.lifeform.unfrozen'
        : 'forge.lifeform.terminated';
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE forge_lifeforms
            SET status=$2, updated_at=$3::timestamptz
          WHERE id=$1`,
        [next.id, next.status, input.audit.occurredAt],
      );
      const payload = { lifeformId: next.id, status: next.status };
      await this.insertEvent(client, lifeform.intentId, eventType, input.audit, payload);
      await this.appendDomainEvent(client, lifeform.intentId, eventType, input.audit, payload);
      await client.query(
        `UPDATE forge_intents SET updated_at=$2::timestamptz WHERE id=$1`,
        [lifeform.intentId, input.audit.occurredAt],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return next;
  }

  private memoryFromRow(row: {
    id: string;
    intent_id: string;
    tenant_id: string;
    text: string;
    status: ForgeMemoryStatus;
    consensus: boolean;
    promoted_constraint: ForgeConstraint | null;
    created_at: Date;
    updated_at: Date;
    created_by: string;
    forgotten_at: Date | null;
    promoted_at: Date | null;
  }): ForgeMemory {
    return freezeMemory({
      id: row.id,
      intentId: row.intent_id,
      tenantId: row.tenant_id,
      text: row.text,
      status: row.status,
      consensus: Boolean(row.consensus),
      ...(row.promoted_constraint
        ? { promotedConstraint: immutableJsonCopy(row.promoted_constraint) }
        : {}),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      createdBy: row.created_by,
      ...(row.forgotten_at ? { forgottenAt: new Date(row.forgotten_at).toISOString() } : {}),
      ...(row.promoted_at ? { promotedAt: new Date(row.promoted_at).toISOString() } : {}),
    });
  }

  async createMemory(input: {
    intentId: string;
    text: string;
    audit: ForgeAudit;
  }): Promise<ForgeMemory> {
    await this.requireIntent(input.intentId, input.audit.tenantId);
    const text = input.text.trim();
    if (!text) throw new ForgeLoopError('MEMORY_TEXT_REQUIRED');
    const id = newMemoryId();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO forge_memories
          (id, intent_id, tenant_id, text, status, consensus, created_at, updated_at, created_by)
         VALUES ($1,$2,$3,$4,'ACTIVE',false,$5::timestamptz,$5::timestamptz,$6)`,
        [
          id,
          input.intentId,
          input.audit.tenantId,
          text,
          input.audit.occurredAt,
          input.audit.actorId,
        ],
      );
      const payload = { memoryId: id, text };
      await this.insertEvent(client, input.intentId, 'forge.memory.created', input.audit, payload);
      await this.appendDomainEvent(client, input.intentId, 'forge.memory.created', input.audit, payload);
      await client.query(
        `UPDATE forge_intents SET updated_at=$2::timestamptz WHERE id=$1`,
        [input.intentId, input.audit.occurredAt],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const created = await this.pool.query(`SELECT * FROM forge_memories WHERE id=$1`, [id]);
    if (!created.rows[0]) throw new ForgeLoopError('MEMORY_NOT_FOUND');
    return this.memoryFromRow(created.rows[0]);
  }

  async listMemories(input: {
    intentId: string;
    tenantId: string;
    includeForgotten?: boolean;
  }): Promise<readonly ForgeMemory[]> {
    await this.requireIntent(input.intentId, input.tenantId);
    const result = await this.pool.query(
      input.includeForgotten
        ? `SELECT * FROM forge_memories
            WHERE intent_id=$1 AND tenant_id=$2
            ORDER BY updated_at DESC, id`
        : `SELECT * FROM forge_memories
            WHERE intent_id=$1 AND tenant_id=$2 AND status <> 'FORGOTTEN'
            ORDER BY updated_at DESC, id`,
      [input.intentId, input.tenantId],
    );
    return Object.freeze(result.rows.map((row) => this.memoryFromRow(row)));
  }

  async getMemory(input: {
    intentId: string;
    memoryId: string;
    tenantId: string;
  }): Promise<ForgeMemory | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM forge_memories WHERE id=$1 AND intent_id=$2 AND tenant_id=$3`,
      [input.memoryId, input.intentId, input.tenantId],
    );
    if (!result.rows[0]) return undefined;
    return this.memoryFromRow(result.rows[0]);
  }

  async forgetMemory(input: {
    intentId: string;
    memoryId: string;
    audit: ForgeAudit;
  }): Promise<ForgeMemory> {
    const memory = await this.getMemory({
      intentId: input.intentId,
      memoryId: input.memoryId,
      tenantId: input.audit.tenantId,
    });
    if (!memory) throw new ForgeLoopError('MEMORY_NOT_FOUND');
    if (memory.status === 'FORGOTTEN') return memory;
    if (memory.status === 'PROMOTED') throw new ForgeLoopError('MEMORY_ALREADY_PROMOTED');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE forge_memories
            SET status='FORGOTTEN', forgotten_at=$2::timestamptz, updated_at=$2::timestamptz
          WHERE id=$1`,
        [memory.id, input.audit.occurredAt],
      );
      const payload = { memoryId: memory.id };
      await this.insertEvent(client, input.intentId, 'forge.memory.forgotten', input.audit, payload);
      await this.appendDomainEvent(client, input.intentId, 'forge.memory.forgotten', input.audit, payload);
      await client.query(
        `UPDATE forge_intents SET updated_at=$2::timestamptz WHERE id=$1`,
        [input.intentId, input.audit.occurredAt],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const next = await this.getMemory({
      intentId: input.intentId,
      memoryId: input.memoryId,
      tenantId: input.audit.tenantId,
    });
    if (!next) throw new ForgeLoopError('MEMORY_NOT_FOUND');
    return next;
  }

  async promoteMemory(input: {
    intentId: string;
    memoryId: string;
    audit: ForgeAudit;
  }): Promise<{ memory: ForgeMemory; intent: ForgeIntent }> {
    const intent = await this.requireIntent(input.intentId, input.audit.tenantId);
    const memory = await this.getMemory({
      intentId: input.intentId,
      memoryId: input.memoryId,
      tenantId: input.audit.tenantId,
    });
    if (!memory) throw new ForgeLoopError('MEMORY_NOT_FOUND');
    if (memory.status === 'FORGOTTEN') throw new ForgeLoopError('MEMORY_FORGOTTEN');
    if (memory.status === 'PROMOTED') return { memory, intent };
    if (intent.frozen) throw new ForgeLoopError('INTENT_FROZEN');
    const promotedConstraint = constraintFromMemory(memory.text);
    const nextConstraints = [...intent.constraints, promotedConstraint];
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE forge_memories
            SET status='PROMOTED', consensus=true, promoted_constraint=$2::jsonb,
                promoted_at=$3::timestamptz, updated_at=$3::timestamptz
          WHERE id=$1`,
        [memory.id, JSON.stringify(promotedConstraint), input.audit.occurredAt],
      );
      await client.query(
        `UPDATE forge_intents
            SET constraints=$2::jsonb, updated_at=$3::timestamptz
          WHERE id=$1`,
        [input.intentId, JSON.stringify(nextConstraints), input.audit.occurredAt],
      );
      const payload = {
        memoryId: memory.id,
        constraint: promotedConstraint,
        consensus: true,
      };
      await this.insertEvent(client, input.intentId, 'forge.memory.promoted', input.audit, payload);
      await this.appendDomainEvent(client, input.intentId, 'forge.memory.promoted', input.audit, payload);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const nextMemory = await this.getMemory({
      intentId: input.intentId,
      memoryId: input.memoryId,
      tenantId: input.audit.tenantId,
    });
    if (!nextMemory) throw new ForgeLoopError('MEMORY_NOT_FOUND');
    return {
      memory: nextMemory,
      intent: await this.requireIntent(input.intentId, input.audit.tenantId),
    };
  }

  private async requireIntent(id: string, tenantId: string): Promise<ForgeIntent> {
    const intent = await this.get({ id, tenantId });
    if (!intent) throw new ForgeLoopError('INTENT_NOT_FOUND');
    return intent;
  }

  private toView(row: IntentRow, events: EventRow[]): ForgeIntent {
    const mappedEvents: ForgeEvent[] = events.map(item => Object.freeze({
      id: item.id,
      type: item.event_type,
      at: new Date(item.occurred_at).toISOString(),
      actorId: item.actor_id,
      payload: immutableJsonCopy(item.payload ?? {}),
    }));
    let constraints: readonly ForgeConstraint[];
    try {
      constraints = normalizeConstraints(row.constraints ?? []);
    } catch {
      constraints = Object.freeze([]);
    }
    if (constraints.length === 0) {
      constraints = legacyConstraintsFromStatement(row.statement);
    }
    return Object.freeze({
      id: row.id,
      tenantId: row.tenant_id,
      principalId: row.principal_id,
      statement: row.statement,
      constraints,
      frozen: Boolean(row.frozen),
      stake: Number(row.stake),
      status: row.status,
      adapterId: row.adapter_id,
      ...(row.pxn_task_id ? { pxnTaskId: row.pxn_task_id } : {}),
      ...(row.pxn_path ? { pxnPath: immutableJsonCopy(row.pxn_path) } : {}),
      ...(row.deploy_job_id ? { deployJobId: row.deploy_job_id } : {}),
      ...(row.deploy_job ? { deployJob: immutableJsonCopy(row.deploy_job) } : {}),
      ...(row.credit_minted != null ? { creditMinted: Number(row.credit_minted) } : {}),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      ...(row.confirmed_at ? { confirmedAt: new Date(row.confirmed_at).toISOString() } : {}),
      ...(row.settled_at ? { settledAt: new Date(row.settled_at).toISOString() } : {}),
      events: Object.freeze(mappedEvents),
    });
  }

  private async insertEvent(
    client: { query: Pool['query'] },
    intentId: string,
    type: string,
    audit: ForgeAudit,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const id = `fev:${intentId}:${type}:${audit.idempotencyKey}`.slice(0, 200);
    await client.query(
      `INSERT INTO forge_intent_events
        (id, intent_id, event_type, occurred_at, actor_id, payload)
       VALUES ($1,$2,$3,$4::timestamptz,$5,$6::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [id, intentId, type, audit.occurredAt, audit.actorId, JSON.stringify(payload)],
    );
  }

  private async appendDomainEvent(
    client: { query: Pool['query'] },
    intentId: string,
    eventType: string,
    audit: ForgeAudit,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const eventId = `event:forge:${intentId}:${eventType}:${audit.idempotencyKey}`.slice(0, 200);
    const body = { intentId, actorId: audit.actorId, requestId: audit.requestId, ...payload };
    await client.query(
      `INSERT INTO domain_events
        (id, aggregate_type, aggregate_id, event_type, occurred_at, payload)
       VALUES ($1,'forge_intent',$2,$3,$4::timestamptz,$5::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [eventId, intentId, eventType, audit.occurredAt, JSON.stringify(body)],
    );
    await client.query(
      `INSERT INTO outbox_messages
        (id, topic, partition_key, event_id, payload, status, created_at)
       VALUES ($1,'pxn.forge-events',$2,$3,$4::jsonb,'PENDING',$5::timestamptz)
       ON CONFLICT (id) DO NOTHING`,
      [
        `outbox:forge:${intentId}:${eventType}:${audit.idempotencyKey}`.slice(0, 200),
        intentId,
        eventId,
        JSON.stringify({ eventId, ...body }),
        audit.occurredAt,
      ],
    );
  }
}
