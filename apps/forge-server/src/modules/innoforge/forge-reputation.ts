export const REPUTATION_BASELINE = 500;
export const REPUTATION_ADOPT_SETTLED_BONUS = 10;
export const REPUTATION_REJECT_PENALTY = 2;
export const REPUTATION_MIN = 0;
export const REPUTATION_MAX = 999;

export type ForgeReputation = Readonly<{
  score: number;
  /** Tenant-relative "top X%" (1–100). null when sample size < 2. */
  topPercent: number | null;
  adoptSettledCount: number;
  rejectCount: number;
  baseline: number;
}>;

export function computeReputationScore(input: {
  adoptSettledCount: number;
  rejectCount: number;
}): number {
  const raw = REPUTATION_BASELINE
    + REPUTATION_ADOPT_SETTLED_BONUS * Math.max(0, input.adoptSettledCount)
    - REPUTATION_REJECT_PENALTY * Math.max(0, input.rejectCount);
  return Math.min(REPUTATION_MAX, Math.max(REPUTATION_MIN, Math.round(raw)));
}

/**
 * Rank principals by score descending; return topPercent for subject.
 * n < 2 → null (honest empty percentile).
 */
export function computeReputationTopPercent(input: {
  subjectId: string;
  scoresByPrincipal: ReadonlyMap<string, number>;
}): number | null {
  const entries = [...input.scoresByPrincipal.entries()]
    .sort((left, right) => {
      const byScore = right[1] - left[1];
      if (byScore !== 0) return byScore;
      return left[0].localeCompare(right[0]);
    });
  if (entries.length < 2) return null;
  const rankIndex = entries.findIndex(([id]) => id === input.subjectId);
  if (rankIndex < 0) return null;
  return Math.max(1, Math.round((100 * (rankIndex + 1)) / entries.length));
}

export function buildReputation(input: {
  principalId: string;
  adoptSettledCount: number;
  rejectCount: number;
  peerScores: ReadonlyMap<string, number>;
}): ForgeReputation {
  const score = computeReputationScore({
    adoptSettledCount: input.adoptSettledCount,
    rejectCount: input.rejectCount,
  });
  const scores = new Map(input.peerScores);
  if (!scores.has(input.principalId)) scores.set(input.principalId, score);
  return Object.freeze({
    score,
    topPercent: computeReputationTopPercent({
      subjectId: input.principalId,
      scoresByPrincipal: scores,
    }),
    adoptSettledCount: input.adoptSettledCount,
    rejectCount: input.rejectCount,
    baseline: REPUTATION_BASELINE,
  });
}
