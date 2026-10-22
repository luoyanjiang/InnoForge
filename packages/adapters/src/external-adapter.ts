/** Pluggable external-system adapters for InnoForge × PXN deploy gateway. */

export type ExternalAdapterCategory =
  | 'manufacturing'
  | 'supply_chain'
  | 'intelligence'
  | 'identity'
  | 'commerce'
  | 'observability';

export type ExternalJobStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED';

export type ExternalJob = Readonly<{
  jobId: string;
  adapterId: string;
  category: ExternalAdapterCategory;
  status: ExternalJobStatus;
  payload: Readonly<Record<string, unknown>>;
  result?: Readonly<Record<string, unknown>>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  reason?: string;
}>;

export type ExternalAdapterHealth = Readonly<{
  adapterId: string;
  category: ExternalAdapterCategory;
  mode: 'simulator' | 'real';
  healthy: boolean;
  detail?: string;
}>;

export interface ExternalAdapter {
  readonly adapterId: string;
  readonly category: ExternalAdapterCategory;
  readonly mode: 'simulator' | 'real';
  health(): Promise<ExternalAdapterHealth>;
  createJob(input: {
    jobId: string;
    payload: Readonly<Record<string, unknown>>;
    at: string;
  }): Promise<ExternalJob>;
  getJob(jobId: string): Promise<ExternalJob | undefined>;
  cancelJob(jobId: string, reason: string, at: string): Promise<ExternalJob>;
  /** Advance simulated work; Real providers may no-op. */
  tick?(jobId: string, at: string): Promise<ExternalJob>;
}
