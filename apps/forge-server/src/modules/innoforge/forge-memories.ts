import { createHash, randomUUID } from 'node:crypto';

import { immutableJsonCopy } from '../../../../../packages/domain/src/canonical-json.js';
import type { ForgeConstraint } from './forge-constraints.js';

export type ForgeMemoryStatus = 'ACTIVE' | 'FORGOTTEN' | 'PROMOTED';

export type ForgeMemory = Readonly<{
  id: string;
  intentId: string;
  tenantId: string;
  text: string;
  status: ForgeMemoryStatus;
  consensus: boolean;
  promotedConstraint?: ForgeConstraint;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  forgottenAt?: string;
  promotedAt?: string;
}>;

export function memoryIdFor(intentId: string, text: string, at: string): string {
  return `fmem:${createHash('sha256').update(`${intentId}:${text}:${at}`).digest('hex').slice(0, 24)}`;
}

export function newMemoryId(): string {
  return `fmem:${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

export function freezeMemory(input: ForgeMemory): ForgeMemory {
  return Object.freeze({
    ...input,
    ...(input.promotedConstraint
      ? { promotedConstraint: immutableJsonCopy(input.promotedConstraint) }
      : {}),
  });
}

/** Promote a memory text into a G1 consensus constraint (rule/echo, no LLM). */
export function constraintFromMemory(text: string): ForgeConstraint {
  const trimmed = text.trim().slice(0, 200);
  return Object.freeze({
    key: 'consensus',
    op: '~' as const,
    value: trimmed,
  });
}
