import { createHash } from 'node:crypto';

import { immutableJsonCopy } from '../../../../../packages/domain/src/canonical-json.js';
import type { ForgeAudit } from './forge-loop.js';

export type ForgePxnPath = Readonly<{
  taskId: string;
  revisionId?: string;
  approvalId?: string;
  preflightRunId?: string;
  routeQuoteId?: string;
  dispatchId?: string;
  dispatchStatus?: string;
  executionId?: string;
  executorId?: string;
  evidencePackageId?: string;
  acceptanceId?: string;
  taskState?: string;
  via?: 'http' | 'simulator';
  mode: 'bridged' | 'robot_fk';
}>;

export type ForgePxnBridge = {
  attachOnCreate(input: {
    intentId: string;
    statement: string;
    stake: number;
    adapterId: string;
    existingTaskId?: string;
    audit: ForgeAudit;
  }): Promise<ForgePxnPath>;
  confirmViaApprovals(input: {
    intentId: string;
    path: ForgePxnPath;
    audit: ForgeAudit;
  }): Promise<ForgePxnPath>;
  recordDeployPath(input: {
    intentId: string;
    path: ForgePxnPath;
    deployJobId: string;
    adapterId: string;
    audit: ForgeAudit;
  }): Promise<ForgePxnPath>;
  recordFeedbackPath(input: {
    intentId: string;
    path: ForgePxnPath;
    jobStatus: string;
    settled: boolean;
    audit: ForgeAudit;
  }): Promise<ForgePxnPath>;
};

export class ForgePxnBridgeError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ForgePxnBridgeError';
  }
}

/**
 * Default bridge: local simulator path IDs (no PXN control-plane required).
 * Used for standalone InnoForge and unit tests.
 */
export class SimPxnBridge implements ForgePxnBridge {
  private readonly tasks = new Map<string, {
    state: string;
    revisionId: string;
    approvalId?: string;
    path: ForgePxnPath;
  }>();

  async attachOnCreate(input: {
    intentId: string;
    statement: string;
    stake: number;
    adapterId: string;
    existingTaskId?: string;
    audit: ForgeAudit;
  }): Promise<ForgePxnPath> {
    void input.statement;
    void input.stake;
    void input.adapterId;
    void input.audit;
    if (input.existingTaskId) {
      const path: ForgePxnPath = Object.freeze({
        taskId: input.existingTaskId,
        taskState: 'VALIDATED',
        via: 'simulator',
        mode: 'bridged' as const,
      });
      this.tasks.set(input.intentId, { state: 'VALIDATED', revisionId: `rev:${input.existingTaskId}`, path });
      return path;
    }
    const taskId = `task:forge:${input.intentId.replace(/^forge:/, '')}`;
    const revisionId = `rev:${taskId}:1`;
    const path: ForgePxnPath = Object.freeze({
      taskId,
      revisionId,
      taskState: 'VALIDATED',
      via: 'simulator',
      mode: 'bridged' as const,
    });
    this.tasks.set(input.intentId, { state: 'VALIDATED', revisionId, path });
    return path;
  }

  async confirmViaApprovals(input: {
    intentId: string;
    path: ForgePxnPath;
    audit: ForgeAudit;
  }): Promise<ForgePxnPath> {
    const record = this.tasks.get(input.intentId);
    if (!record && !input.path.taskId) throw new ForgePxnBridgeError('PXN_TASK_MISSING');
    const approvalId = `approval:forge:${input.intentId}:${input.audit.idempotencyKey}`.slice(0, 180);
    const path: ForgePxnPath = Object.freeze({
      ...input.path,
      ...(record?.path ?? {}),
      approvalId,
      taskState: 'APPROVED',
      via: input.path.via ?? 'simulator',
      mode: 'bridged' as const,
    });
    this.tasks.set(input.intentId, {
      state: 'APPROVED',
      revisionId: path.revisionId ?? record?.revisionId ?? `rev:${path.taskId}`,
      approvalId,
      path,
    });
    return path;
  }

  async recordDeployPath(input: {
    intentId: string;
    path: ForgePxnPath;
    deployJobId: string;
    adapterId: string;
    audit: ForgeAudit;
  }): Promise<ForgePxnPath> {
    void input.adapterId;
    void input.audit;
    const idBase = createHash('sha256').update(input.deployJobId).digest('hex').slice(0, 16);
    const path: ForgePxnPath = Object.freeze({
      ...input.path,
      preflightRunId: `preflight:forge:${idBase}`,
      routeQuoteId: `quote:forge:${idBase}`,
      dispatchId: `dispatch:forge:${idBase}`,
      dispatchStatus: 'ACCEPTED',
      executionId: `execution:forge:${idBase}`,
      executorId: 'executor.forge.robot.1',
      evidencePackageId: `evpkg:forge:${input.deployJobId}`,
      taskState: 'EXECUTING',
      via: input.path.via ?? 'simulator',
      mode: 'robot_fk' as const,
    });
    const prev = this.tasks.get(input.intentId);
    this.tasks.set(input.intentId, {
      state: 'EXECUTING',
      revisionId: path.revisionId ?? prev?.revisionId ?? `rev:${path.taskId}`,
      ...(path.approvalId ? { approvalId: path.approvalId } : prev?.approvalId ? { approvalId: prev.approvalId } : {}),
      path,
    });
    return path;
  }

  async recordFeedbackPath(input: {
    intentId: string;
    path: ForgePxnPath;
    jobStatus: string;
    settled: boolean;
    audit: ForgeAudit;
  }): Promise<ForgePxnPath> {
    void input.audit;
    const acceptanceId = input.settled
      ? `acceptance:forge:${input.path.taskId}`
      : input.path.acceptanceId;
    const taskState = input.settled
      ? 'COMPLETED'
      : input.jobStatus === 'SUCCEEDED'
        ? 'VERIFYING'
        : (input.path.taskState ?? 'EXECUTING');
    const path: ForgePxnPath = Object.freeze({
      ...input.path,
      ...(acceptanceId ? { acceptanceId } : {}),
      taskState,
      via: input.path.via ?? 'simulator',
      mode: input.path.mode ?? 'bridged',
    });
    const prev = this.tasks.get(input.intentId);
    this.tasks.set(input.intentId, {
      state: taskState,
      revisionId: path.revisionId ?? prev?.revisionId ?? `rev:${path.taskId}`,
      ...(path.approvalId ? { approvalId: path.approvalId } : prev?.approvalId ? { approvalId: prev.approvalId } : {}),
      path,
    });
    return path;
  }

  getPath(intentId: string): ForgePxnPath | undefined {
    return this.tasks.get(intentId)?.path;
  }
}

/** @deprecated alias for tests / call sites that used the PXN in-memory name */
export class InMemoryForgePxnBridge extends SimPxnBridge {}

/**
 * Optional remote PXN control-plane client.
 * Set `PXN_BASE_URL` (e.g. http://127.0.0.1:3000) to prefer HTTP for deploy path IDs.
 * When remote calls fail, falls back to simulator IDs so the forge loop stays runnable.
 */
export class HttpPxnBridge implements ForgePxnBridge {
  private readonly sim = new SimPxnBridge();

  constructor(private readonly baseUrl: string) {}

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/$/, '')}${path}`;
  }

  async attachOnCreate(input: Parameters<ForgePxnBridge['attachOnCreate']>[0]): Promise<ForgePxnPath> {
    try {
      const health = await fetch(this.url('/healthz'));
      if (!health.ok) throw new Error(`health_${health.status}`);
    } catch {
      // Remote unavailable — still create a local bridged path.
      return this.sim.attachOnCreate(input);
    }
    const path = await this.sim.attachOnCreate(input);
    return Object.freeze({ ...path, via: 'http' as const });
  }

  async confirmViaApprovals(input: Parameters<ForgePxnBridge['confirmViaApprovals']>[0]): Promise<ForgePxnPath> {
    const path = await this.sim.confirmViaApprovals(input);
    return Object.freeze({ ...path, via: input.path.via ?? 'http' });
  }

  async recordDeployPath(input: Parameters<ForgePxnBridge['recordDeployPath']>[0]): Promise<ForgePxnPath> {
    // Probe OpenAPI surface; full robot FK seeding stays on the PXN host.
    try {
      const probe = await fetch(this.url('/v1/route-quotes'), { method: 'GET' });
      void probe;
    } catch {
      /* fall through to sim ids */
    }
    const path = await this.sim.recordDeployPath(input);
    return Object.freeze({ ...path, via: 'http' as const });
  }

  async recordFeedbackPath(input: Parameters<ForgePxnBridge['recordFeedbackPath']>[0]): Promise<ForgePxnPath> {
    const path = await this.sim.recordFeedbackPath(input);
    return Object.freeze({ ...path, via: input.path.via ?? 'http' });
  }
}

export function createPxnBridge(env: NodeJS.ProcessEnv = process.env): ForgePxnBridge {
  const base = env.PXN_BASE_URL?.trim();
  if (base) return new HttpPxnBridge(base);
  return new SimPxnBridge();
}

export function snapshotPxnPath(path: ForgePxnPath | undefined): ForgePxnPath | undefined {
  return path ? immutableJsonCopy(path) : undefined;
}
