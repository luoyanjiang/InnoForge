import { createHash, randomUUID } from 'node:crypto';

export type PartnerConfig = Readonly<{
  tenantId: string;
  outboundUrl: string;
  enabled: boolean;
  updatedAt: string;
}>;

export type PartnerEvent = Readonly<{
  id: string;
  tenantId: string;
  direction: 'outbound' | 'inbound' | 'receiver';
  kind: string;
  status: 'QUEUED' | 'DELIVERED' | 'FAILED' | 'ACKED' | 'SIMULATED';
  payload: Readonly<Record<string, unknown>>;
  at: string;
  detail?: string;
}>;

/**
 * Partner HTTP + local CNC/fab simulator.
 * Default outbound targets the in-process webhook receiver (sim-first).
 */
export class PartnerGateway {
  private readonly configs = new Map<string, PartnerConfig>();
  private readonly events: PartnerEvent[] = [];

  defaultReceiverPath(): string {
    return '/v1/forge/partner/webhook-receiver';
  }

  getConfig(tenantId: string, baseUrl = 'http://127.0.0.1:3000'): PartnerConfig {
    const existing = this.configs.get(tenantId);
    if (existing) return existing;
    const created: PartnerConfig = Object.freeze({
      tenantId,
      outboundUrl: `${baseUrl}${this.defaultReceiverPath()}`,
      enabled: true,
      updatedAt: new Date().toISOString(),
    });
    this.configs.set(tenantId, created);
    return created;
  }

  setConfig(input: {
    tenantId: string;
    outboundUrl: string;
    enabled: boolean;
  }): PartnerConfig {
    const url = input.outboundUrl.trim();
    if (!url) throw new PartnerGatewayError('OUTBOUND_URL_REQUIRED');
    const config: PartnerConfig = Object.freeze({
      tenantId: input.tenantId,
      outboundUrl: url,
      enabled: input.enabled,
      updatedAt: new Date().toISOString(),
    });
    this.configs.set(input.tenantId, config);
    return config;
  }

  listEvents(tenantId: string, limit = 40): readonly PartnerEvent[] {
    return this.events.filter((item) => item.tenantId === tenantId).slice(-limit).reverse();
  }

  private push(event: PartnerEvent): PartnerEvent {
    this.events.push(event);
    if (this.events.length > 500) this.events.splice(0, this.events.length - 500);
    return event;
  }

  async sendOutbound(input: {
    tenantId: string;
    kind: string;
    payload: Readonly<Record<string, unknown>>;
    baseUrl?: string;
  }): Promise<PartnerEvent> {
    const config = this.getConfig(input.tenantId, input.baseUrl);
    if (!config.enabled) throw new PartnerGatewayError('PARTNER_DISABLED');
    const id = `partner-out-${randomUUID()}`;
    const at = new Date().toISOString();
    const body = {
      eventId: id,
      kind: input.kind,
      tenantId: input.tenantId,
      payload: input.payload,
      signature: `sha256:${createHash('sha256').update(`${id}:${input.kind}`).digest('hex')}`,
      at,
    };

    try {
      const response = await fetch(config.outboundUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': input.tenantId,
          'x-partner-event': input.kind,
        },
        body: JSON.stringify(body),
      });
      const detail = await response.text().catch(() => '');
      return this.push(Object.freeze({
        id,
        tenantId: input.tenantId,
        direction: 'outbound',
        kind: input.kind,
        status: response.ok ? 'DELIVERED' : 'FAILED',
        payload: Object.freeze({ ...input.payload, httpStatus: response.status }),
        at,
        detail: detail.slice(0, 500),
      }));
    } catch (error) {
      return this.push(Object.freeze({
        id,
        tenantId: input.tenantId,
        direction: 'outbound',
        kind: input.kind,
        status: 'FAILED',
        payload: Object.freeze({ ...input.payload }),
        at,
        detail: error instanceof Error ? error.message : 'OUTBOUND_FAILED',
      }));
    }
  }

  receiveCallback(input: {
    tenantId: string;
    kind: string;
    payload: Readonly<Record<string, unknown>>;
  }): PartnerEvent {
    return this.push(Object.freeze({
      id: `partner-in-${randomUUID()}`,
      tenantId: input.tenantId,
      direction: 'inbound',
      kind: input.kind || 'partner.callback',
      status: 'ACKED',
      payload: Object.freeze({ ...input.payload }),
      at: new Date().toISOString(),
    }));
  }

  /** Local CNC / fab simulator that ACKs outbound jobs and emits progress. */
  receiveAsSimulator(input: {
    tenantId: string;
    body: Readonly<Record<string, unknown>>;
  }): PartnerEvent {
    const kind = typeof input.body.kind === 'string' ? input.body.kind : 'fab.job';
    const eventId = typeof input.body.eventId === 'string' ? input.body.eventId : randomUUID();
    return this.push(Object.freeze({
      id: `partner-rx-${randomUUID()}`,
      tenantId: input.tenantId,
      direction: 'receiver',
      kind: 'fab.simulator.ack',
      status: 'SIMULATED',
      payload: Object.freeze({
        ackFor: eventId,
        originalKind: kind,
        machine: 'sim-cnc-01',
        progressPct: 100,
        qc: 'PASS',
        simulated: true,
      }),
      at: new Date().toISOString(),
      detail: 'local CNC/fab receiver',
    }));
  }
}

export class PartnerGatewayError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'PartnerGatewayError';
  }
}

export const partnerGateway = new PartnerGateway();
