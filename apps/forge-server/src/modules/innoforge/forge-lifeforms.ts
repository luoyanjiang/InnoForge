import { createHash, randomUUID } from 'node:crypto';

import { immutableJsonCopy } from '../../../../../packages/domain/src/canonical-json.js';

export type ForgeLifeformStatus = 'ACTIVE' | 'FROZEN' | 'TERMINATED';
export type ForgeLifeformProposalStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';

export type ForgeLifeformProposal = Readonly<{
  id: string;
  summary: string;
  status: ForgeLifeformProposalStatus;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
}>;

export type ForgeLifeform = Readonly<{
  id: string;
  intentId: string;
  tenantId: string;
  name: string;
  status: ForgeLifeformStatus;
  proposals: readonly ForgeLifeformProposal[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}>;

export function lifeformIdFor(intentId: string): string {
  return `flife:${createHash('sha256').update(intentId).digest('hex').slice(0, 24)}`;
}

export function proposalIdFor(lifeformId: string, summary: string, at: string): string {
  return `flprop:${createHash('sha256').update(`${lifeformId}:${summary}:${at}`).digest('hex').slice(0, 24)}`;
}

export function newProposalId(): string {
  return `flprop:${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

export function freezeLifeform(input: ForgeLifeform): ForgeLifeform {
  return Object.freeze({
    ...input,
    proposals: Object.freeze(input.proposals.map((p) => immutableJsonCopy(p))),
  });
}

export function freezeProposal(input: ForgeLifeformProposal): ForgeLifeformProposal {
  return Object.freeze(immutableJsonCopy(input));
}
