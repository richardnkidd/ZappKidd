/** Small shared helpers for the importer (pure; no I/O). */
import { createHash } from 'node:crypto';

export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

/** Deterministic JSON (sorted keys, undefined dropped) so structurally equal values serialize identically. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value)) ?? 'null';
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read a dot path ('data.deadline.date'); undefined when any segment is missing. */
export function getPath(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const seg of path.split('.')) {
    if (FORBIDDEN_KEYS.has(seg)) return undefined;
    if (!isObject(cur) && !Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** Write a dot path, creating intermediate objects. Throws on prototype-polluting segments. */
export function setPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const segs = path.split('.');
  let cur: Record<string, unknown> = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i] as string;
    if (FORBIDDEN_KEYS.has(seg)) throw new Error(`Forbidden path segment: ${seg}`);
    const next = cur[seg];
    if (!isObject(next)) {
      cur[seg] = {};
    }
    cur = cur[seg] as Record<string, unknown>;
  }
  const last = segs[segs.length - 1] as string;
  if (FORBIDDEN_KEYS.has(last)) throw new Error(`Forbidden path segment: ${last}`);
  cur[last] = value;
}

/** Lowercase ASCII slug: letters/digits separated by single hyphens. */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
