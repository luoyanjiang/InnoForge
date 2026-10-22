import type { ForgeEvent, ForgeIntent } from './forge-loop.js';
import type { ForgeJudgment } from './forge-judgments.js';

/** First-class timeline kinds for Intent OS history (G3). */
export type ForgeTimelineKind =
  | 'CREATED'
  | 'UPDATED'
  | 'FROZEN'
  | 'UNFROZEN'
  | 'JUDGMENT'
  | 'CONFIRMED'
  | 'DEPLOYED'
  | 'FEEDBACK'
  | 'SETTLED'
  | 'OTHER';

export type ForgeTimelineItem = Readonly<{
  id: string;
  kind: ForgeTimelineKind;
  at: string;
  intentId: string;
  actorId: string;
  source: 'event' | 'judgment';
  eventType?: string;
  payload: Readonly<Record<string, unknown>>;
}>;

const EVENT_KIND: Readonly<Record<string, ForgeTimelineKind>> = Object.freeze({
  'forge.intent.staked': 'CREATED',
  'forge.intent.updated': 'UPDATED',
  'forge.intent.frozen': 'FROZEN',
  'forge.intent.unfrozen': 'UNFROZEN',
  'forge.judgment.recorded': 'JUDGMENT',
  'forge.intent.confirmed': 'CONFIRMED',
  'forge.deploy.started': 'DEPLOYED',
  'forge.feedback.tick': 'FEEDBACK',
  'forge.credit.settled': 'SETTLED',
});

export function timelineKindFromEventType(type: string): ForgeTimelineKind {
  return EVENT_KIND[type] ?? 'OTHER';
}

function fromEvent(intentId: string, event: ForgeEvent, judgment?: ForgeJudgment): ForgeTimelineItem {
  const kind = timelineKindFromEventType(event.type);
  const payload: Record<string, unknown> = { ...event.payload };
  if (judgment) {
    payload.judgmentId = judgment.id;
    payload.candidateId = judgment.candidateId;
    payload.action = judgment.action;
    payload.impact = judgment.impact;
    if (judgment.rationale) payload.rationale = judgment.rationale;
    payload.candidateTitleEn = judgment.candidateSnapshot.titleEn;
    payload.candidateTitleZh = judgment.candidateSnapshot.titleZh;
  }
  return Object.freeze({
    id: event.id,
    kind,
    at: event.at,
    intentId,
    actorId: event.actorId,
    source: 'event' as const,
    eventType: event.type,
    payload: Object.freeze(payload),
  });
}

function fromJudgment(judgment: ForgeJudgment): ForgeTimelineItem {
  return Object.freeze({
    id: `tl:judgment:${judgment.id}`,
    kind: 'JUDGMENT' as const,
    at: judgment.occurredAt,
    intentId: judgment.intentId,
    actorId: judgment.actorId,
    source: 'judgment' as const,
    payload: Object.freeze({
      judgmentId: judgment.id,
      candidateId: judgment.candidateId,
      action: judgment.action,
      impact: judgment.impact,
      ...(judgment.rationale ? { rationale: judgment.rationale } : {}),
      candidateTitleEn: judgment.candidateSnapshot.titleEn,
      candidateTitleZh: judgment.candidateSnapshot.titleZh,
    }),
  });
}

/**
 * Merge intent events + judgments into a chronological timeline.
 * Judgments already mirrored as events are enriched; orphan judgments are appended once.
 */
export function buildTimeline(input: {
  intents: readonly ForgeIntent[];
  judgments: readonly ForgeJudgment[];
}): readonly ForgeTimelineItem[] {
  const judgmentsById = new Map(input.judgments.map((item) => [item.id, item]));
  const judgmentsByIntent = new Map<string, ForgeJudgment[]>();
  for (const judgment of input.judgments) {
    const list = judgmentsByIntent.get(judgment.intentId) ?? [];
    list.push(judgment);
    judgmentsByIntent.set(judgment.intentId, list);
  }

  const items: ForgeTimelineItem[] = [];
  const seenJudgmentIds = new Set<string>();

  for (const intent of input.intents) {
    for (const event of intent.events) {
      const judgmentId = typeof event.payload.judgmentId === 'string'
        ? event.payload.judgmentId
        : undefined;
      const judgment = judgmentId ? judgmentsById.get(judgmentId) : undefined;
      if (judgment) seenJudgmentIds.add(judgment.id);
      items.push(fromEvent(intent.id, event, judgment));
    }
    for (const judgment of judgmentsByIntent.get(intent.id) ?? []) {
      if (seenJudgmentIds.has(judgment.id)) continue;
      items.push(fromJudgment(judgment));
      seenJudgmentIds.add(judgment.id);
    }
  }

  return Object.freeze(
    [...items].sort((left, right) => {
      const byAt = left.at.localeCompare(right.at);
      return byAt !== 0 ? byAt : left.id.localeCompare(right.id);
    }),
  );
}
