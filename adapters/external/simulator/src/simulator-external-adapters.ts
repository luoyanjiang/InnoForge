import type {
  ExternalAdapter,
  ExternalAdapterCategory,
  ExternalAdapterHealth,
  ExternalJob,
} from '../../../../packages/adapters/src/external-adapter.js';

type MutableJob = { view: ExternalJob; ticks: number };

export class SimulatorExternalAdapter implements ExternalAdapter {
  readonly mode = 'simulator' as const;
  private readonly jobs = new Map<string, MutableJob>();

  constructor(
    readonly adapterId: string,
    readonly category: ExternalAdapterCategory,
    private readonly succeedAfterTicks = 1,
  ) {}

  async health(): Promise<ExternalAdapterHealth> {
    return Object.freeze({
      adapterId: this.adapterId,
      category: this.category,
      mode: this.mode,
      healthy: true,
      detail: 'simulator',
    });
  }

  async createJob(input: {
    jobId: string;
    payload: Readonly<Record<string, unknown>>;
    at: string;
  }): Promise<ExternalJob> {
    const existing = this.jobs.get(input.jobId);
    if (existing) return existing.view;
    const view = Object.freeze({
      jobId: input.jobId,
      adapterId: this.adapterId,
      category: this.category,
      status: 'QUEUED' as const,
      payload: Object.freeze({ ...input.payload }),
      createdAt: input.at,
      updatedAt: input.at,
    });
    this.jobs.set(input.jobId, { view, ticks: 0 });
    return view;
  }

  async getJob(jobId: string): Promise<ExternalJob | undefined> {
    return this.jobs.get(jobId)?.view;
  }

  async cancelJob(jobId: string, reason: string, at: string): Promise<ExternalJob> {
    const job = this.jobs.get(jobId);
    if (!job) throw new SimulatorExternalAdapterError('JOB_NOT_FOUND');
    if (job.view.status === 'SUCCEEDED' || job.view.status === 'FAILED' || job.view.status === 'CANCELLED') {
      return job.view;
    }
    job.view = Object.freeze({
      ...job.view,
      status: 'CANCELLED' as const,
      updatedAt: at,
      completedAt: at,
      reason,
    });
    return job.view;
  }

  async tick(jobId: string, at: string): Promise<ExternalJob> {
    const job = this.jobs.get(jobId);
    if (!job) throw new SimulatorExternalAdapterError('JOB_NOT_FOUND');
    if (job.view.status === 'CANCELLED' || job.view.status === 'FAILED' || job.view.status === 'SUCCEEDED') {
      return job.view;
    }
    job.ticks += 1;
    if (job.view.status === 'QUEUED') {
      job.view = Object.freeze({ ...job.view, status: 'RUNNING' as const, updatedAt: at });
    }
    if (job.ticks >= this.succeedAfterTicks) {
      job.view = Object.freeze({
        ...job.view,
        status: 'SUCCEEDED' as const,
        updatedAt: at,
        completedAt: at,
        result: Object.freeze({
          simulated: true,
          adapterId: this.adapterId,
          category: this.category,
          ticks: job.ticks,
        }),
      });
    }
    return job.view;
  }
}

export class SimulatorExternalAdapterError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'SimulatorExternalAdapterError';
  }
}

/** Default catalog aligned with InnoForge external-systems map (simulator only). */
export function createDefaultSimulatorRegistry(): ReadonlyMap<string, ExternalAdapter> {
  const adapters: ExternalAdapter[] = [
    new SimulatorExternalAdapter('mfg-cnc', 'manufacturing'),
    new SimulatorExternalAdapter('mfg-print', 'manufacturing'),
    new SimulatorExternalAdapter('mfg-fab', 'manufacturing', 2),
    new SimulatorExternalAdapter('mfg-mes', 'manufacturing'),
    new SimulatorExternalAdapter('mfg-robot', 'manufacturing'),
    new SimulatorExternalAdapter('mfg-iot', 'manufacturing'),
    new SimulatorExternalAdapter('mfg-twin', 'manufacturing'),
    new SimulatorExternalAdapter('sc-supply', 'supply_chain'),
    new SimulatorExternalAdapter('sc-logistics', 'supply_chain'),
    new SimulatorExternalAdapter('sc-erp', 'supply_chain'),
    new SimulatorExternalAdapter('sc-qms', 'supply_chain'),
    new SimulatorExternalAdapter('intel-llm', 'intelligence'),
    new SimulatorExternalAdapter('intel-memory', 'intelligence'),
    new SimulatorExternalAdapter('intel-dfm', 'intelligence'),
    new SimulatorExternalAdapter('intel-ci', 'intelligence'),
    new SimulatorExternalAdapter('id-idp', 'identity'),
    new SimulatorExternalAdapter('id-scim', 'identity'),
    new SimulatorExternalAdapter('id-siem', 'identity'),
    new SimulatorExternalAdapter('id-notify', 'identity'),
    new SimulatorExternalAdapter('com-payment', 'commerce'),
    new SimulatorExternalAdapter('com-tax', 'commerce'),
    new SimulatorExternalAdapter('com-market', 'commerce'),
    new SimulatorExternalAdapter('com-ledger', 'commerce'),
    new SimulatorExternalAdapter('ops-storage', 'observability'),
    new SimulatorExternalAdapter('ops-kms', 'observability'),
    new SimulatorExternalAdapter('ops-otel', 'observability'),
    new SimulatorExternalAdapter('ops-secrets', 'observability'),
  ];
  return new Map(adapters.map(adapter => [adapter.adapterId, adapter]));
}
