import type { MatchState } from './types';

/** Canonical serialization: sorted keys, exact number text — stable across runs. */
function serialize(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(serialize).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((k) => `${k}:${serialize(record[k])}`).join(',')}}`;
  }
  return `${typeof value}:${String(value)}`;
}

function fnv1a(text: string, seed: number): number {
  let hash = seed | 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic fingerprint of the full state (two FNV-1a lanes), 16 hex chars. */
export function stateHash(s: MatchState): string {
  const text = serialize(s);
  const hi = fnv1a(text, 0x811c9dc5);
  const lo = fnv1a(text, 0x27d4eb2f);
  return hi.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0');
}
