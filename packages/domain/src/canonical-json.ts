import { createHash } from 'node:crypto';

export class CanonicalJsonError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'CanonicalJsonError';
  }
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new CanonicalJsonError('CANONICAL_JSON_NON_FINITE_NUMBER');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  throw new CanonicalJsonError('CANONICAL_JSON_UNSUPPORTED_VALUE');
}

export function canonicalSha256(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function immutableJsonCopy<T>(value: T): T {
  return deepFreeze(JSON.parse(canonicalJson(value)) as T);
}
