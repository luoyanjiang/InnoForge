import { createHash } from 'node:crypto';

export type ForgeAllocationRole = 'proposer' | 'suggester' | 'confirmer';

export type ForgeAllocationWeights = Readonly<{
  proposer: number;
  suggester: number;
  confirmer: number;
}>;

/** Default Intent OS attribution weights (%). */
export const DEFAULT_ALLOCATION_WEIGHTS: ForgeAllocationWeights = Object.freeze({
  proposer: 38.5,
  suggester: 32,
  confirmer: 29.5,
});

export type ForgeCreditAllocation = Readonly<{
  id: string;
  intentId: string;
  tenantId: string;
  principalId: string;
  role: ForgeAllocationRole;
  weightPercent: number;
  amount: number;
  occurredAt: string;
}>;

export function allocationIdFor(
  intentId: string,
  role: ForgeAllocationRole,
  principalId: string,
): string {
  return `falloc:${createHash('sha256').update(`${intentId}:${role}:${principalId}`).digest('hex').slice(0, 24)}`;
}

function uniqueActors(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => Boolean(id)))];
}

/**
 * Split minted Credit by attribution roles.
 * Empty suggester pool folds suggester weight into proposer (solo-demo friendly).
 * Amounts are integers; remainder cents go to proposer so sum === minted.
 */
export function computeCreditAllocations(input: {
  intentId: string;
  tenantId: string;
  minted: number;
  proposerId: string;
  suggesterIds: readonly string[];
  confirmerId: string;
  occurredAt: string;
  weights?: ForgeAllocationWeights;
}): readonly ForgeCreditAllocation[] {
  if (!(input.minted >= 0) || !Number.isFinite(input.minted)) {
    throw new Error('ALLOCATION_MINTED_INVALID');
  }
  const weights = input.weights ?? DEFAULT_ALLOCATION_WEIGHTS;
  const suggesters = uniqueActors(input.suggesterIds);
  const suggesterEmpty = suggesters.length === 0;

  const proposerWeight = suggesterEmpty
    ? weights.proposer + weights.suggester
    : weights.proposer;
  const suggesterWeight = suggesterEmpty ? 0 : weights.suggester;
  const confirmerWeight = weights.confirmer;
  const totalWeight = proposerWeight + suggesterWeight + confirmerWeight;

  type Draft = {
    principalId: string;
    role: ForgeAllocationRole;
    weightPercent: number;
    raw: number;
  };

  const drafts: Draft[] = [];
  drafts.push({
    principalId: input.proposerId,
    role: 'proposer',
    weightPercent: proposerWeight,
    raw: (input.minted * proposerWeight) / totalWeight,
  });

  if (!suggesterEmpty) {
    const eachWeight = suggesterWeight / suggesters.length;
    for (const principalId of suggesters) {
      drafts.push({
        principalId,
        role: 'suggester',
        weightPercent: eachWeight,
        raw: (input.minted * eachWeight) / totalWeight,
      });
    }
  }

  drafts.push({
    principalId: input.confirmerId,
    role: 'confirmer',
    weightPercent: confirmerWeight,
    raw: (input.minted * confirmerWeight) / totalWeight,
  });

  // Floor then distribute remainder to largest fractional parts (stable by role/id).
  const floored = drafts.map((draft) => ({
    ...draft,
    amount: Math.floor(draft.raw),
    frac: draft.raw - Math.floor(draft.raw),
  }));
  let remainder = input.minted - floored.reduce((sum, item) => sum + item.amount, 0);
  const order = [...floored].sort((left, right) => {
    const byFrac = right.frac - left.frac;
    if (byFrac !== 0) return byFrac;
    const byRole = left.role.localeCompare(right.role);
    if (byRole !== 0) return byRole;
    return left.principalId.localeCompare(right.principalId);
  });
  for (const item of order) {
    if (remainder <= 0) break;
    item.amount += 1;
    remainder -= 1;
  }

  // Merge same principal+role (shouldn't happen) — keep one row per role×principal.
  return Object.freeze(
    floored.map((item) => Object.freeze({
      id: allocationIdFor(input.intentId, item.role, item.principalId),
      intentId: input.intentId,
      tenantId: input.tenantId,
      principalId: item.principalId,
      role: item.role,
      weightPercent: Math.round(item.weightPercent * 1000) / 1000,
      amount: item.amount,
      occurredAt: input.occurredAt,
    })),
  );
}

export function allocationAmountsByPrincipal(
  allocations: readonly ForgeCreditAllocation[],
): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  for (const item of allocations) {
    map.set(item.principalId, (map.get(item.principalId) ?? 0) + item.amount);
  }
  return map;
}
