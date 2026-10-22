import type { FastifyReply, FastifyRequest } from 'fastify';

export type SseRoomKind = 'negotiate' | 'governance';

export type SseMessage = Readonly<{
  id: string;
  room: SseRoomKind;
  tenantId: string;
  actorId: string;
  text: string;
  at: string;
}>;

type Client = {
  tenantId: string;
  actorId: string;
  reply: FastifyReply;
};

/** In-process tenant-scoped SSE hub for negotiate / governance rooms. */
export class ForgeSseHub {
  private readonly clients = new Map<SseRoomKind, Set<Client>>();
  private readonly history = new Map<string, SseMessage[]>();
  private seq = 0;

  constructor() {
    this.clients.set('negotiate', new Set());
    this.clients.set('governance', new Set());
  }

  historyFor(room: SseRoomKind, tenantId: string): readonly SseMessage[] {
    return this.history.get(`${room}:${tenantId}`) ?? [];
  }

  async subscribe(input: {
    room: SseRoomKind;
    tenantId: string;
    actorId: string;
    request: FastifyRequest;
    reply: FastifyReply;
  }): Promise<void> {
    const { room, tenantId, actorId, request, reply } = input;
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(`event: hello\ndata: ${JSON.stringify({ room, tenantId, actorId })}\n\n`);

    for (const message of this.historyFor(room, tenantId).slice(-40)) {
      reply.raw.write(`id: ${message.id}\nevent: message\ndata: ${JSON.stringify(message)}\n\n`);
    }

    const client: Client = { tenantId, actorId, reply };
    this.clients.get(room)!.add(client);

    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(`: ping ${Date.now()}\n\n`);
      } catch {
        clearInterval(heartbeat);
      }
    }, 15_000);

    const cleanup = () => {
      clearInterval(heartbeat);
      this.clients.get(room)?.delete(client);
    };
    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);
  }

  publish(input: {
    room: SseRoomKind;
    tenantId: string;
    actorId: string;
    text: string;
    at?: string;
  }): SseMessage {
    const message: SseMessage = Object.freeze({
      id: `sse-${++this.seq}`,
      room: input.room,
      tenantId: input.tenantId,
      actorId: input.actorId,
      text: input.text.trim(),
      at: input.at ?? new Date().toISOString(),
    });
    if (!message.text) throw new Error('SSE_TEXT_REQUIRED');
    const key = `${input.room}:${input.tenantId}`;
    const list = this.history.get(key) ?? [];
    list.push(message);
    this.history.set(key, list.slice(-100));

    for (const client of this.clients.get(input.room) ?? []) {
      if (client.tenantId !== input.tenantId) continue;
      try {
        client.reply.raw.write(`id: ${message.id}\nevent: message\ndata: ${JSON.stringify(message)}\n\n`);
      } catch {
        this.clients.get(input.room)?.delete(client);
      }
    }
    return message;
  }
}

export const forgeSseHub = new ForgeSseHub();
