import { immutableJsonCopy } from '../../../../../packages/domain/src/canonical-json.js';
import { ForgeLoopError } from './forge-loop.js';

export type ForgeConstraintOp = '<=' | '>=' | '<' | '>' | '=' | '~';

export type ForgeConstraint = Readonly<{
  key: string;
  op: ForgeConstraintOp;
  value: string;
  unit?: string;
}>;

const OPS = new Set<ForgeConstraintOp>(['<=', '>=', '<', '>', '=', '~']);

/** Normalize and validate structured constraints for forge intents. */
export function normalizeConstraints(raw: unknown): readonly ForgeConstraint[] {
  if (raw == null) return Object.freeze([]);
  if (!Array.isArray(raw)) throw new ForgeLoopError('CONSTRAINTS_INVALID');
  const out: ForgeConstraint[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') throw new ForgeLoopError('CONSTRAINTS_INVALID');
    const row = item as Record<string, unknown>;
    const key = typeof row.key === 'string' ? row.key.trim() : '';
    const opRaw = typeof row.op === 'string' ? row.op.trim() : '';
    const value = row.value == null ? '' : String(row.value).trim();
    const unit = typeof row.unit === 'string' ? row.unit.trim() : undefined;
    if (!key || !value || !OPS.has(opRaw as ForgeConstraintOp)) {
      throw new ForgeLoopError('CONSTRAINTS_INVALID');
    }
    const op = opRaw as ForgeConstraintOp;
    out.push(Object.freeze({
      key,
      op,
      value,
      ...(unit ? { unit } : {}),
    }));
  }
  return Object.freeze(out.map((c) => immutableJsonCopy(c)));
}

export function constraintsEqual(
  left: readonly ForgeConstraint[] | undefined,
  right: readonly ForgeConstraint[] | undefined,
): boolean {
  return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
}

/**
 * Legacy create path stuffed free-text constraints into statement as
 * `...\n\n[Mass ≤ 180g; ...]`. Recover a single free-text constraint when present.
 */
export function legacyConstraintsFromStatement(statement: string): readonly ForgeConstraint[] {
  const match = statement.match(/\n\n\[([^\]]+)\]\s*$/);
  if (!match?.[1]) return Object.freeze([]);
  return Object.freeze([
    Object.freeze({ key: 'legacy', op: '~' as const, value: match[1].trim() }),
  ]);
}

export function formatConstraint(c: ForgeConstraint): string {
  return c.unit ? `${c.key} ${c.op} ${c.value} ${c.unit}` : `${c.key} ${c.op} ${c.value}`;
}
