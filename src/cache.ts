import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

/**
 * Persistent scan cache. Parsing years of agent transcripts can take seconds,
 * but transcript files are append-mostly, so parsed results are keyed by
 * (mtime, size) per file and reused across CLI invocations. The cache holds
 * raw parsed data only - pricing and filtering are always applied fresh.
 *
 * Stored as one JSON document under `<home>/.agentstats/`; disable with
 * AGENTSTATS_NO_CACHE=1. Every failure mode (missing dir, corrupt JSON,
 * bad shape, unwritable disk) degrades to "no cache", never to an error.
 */

/**
 * Bump whenever a change alters what the adapters produce for unchanged
 * files (parser fixes, new event sources, field or shape renames) - otherwise
 * stale cached results would outlive the bug they were parsed with.
 */
const CACHE_VERSION = 3;

interface CacheEntry {
  key: string;
  value: unknown;
}

type CacheMap = Record<string, CacheEntry>;

export function cacheDisabled(): boolean {
  return !!process.env.AGENTSTATS_NO_CACHE;
}

export function cachePath(home: string): string {
  return path.join(home, '.agentstats', 'scan-cache-v1.json');
}

/** Never persist absurdly large result sets (corrupt logs, runaway scans). */
const MAX_CACHED_EVENTS = 250_000;

export interface PersistentCache {
  get(file: string, key: string): unknown;
  put(file: string, key: string, value: unknown): void;
  /** Write the cache to disk if anything changed. Never throws. */
  flush(): void;
  cachedFiles(): number;
}

export function openCache(home: string): PersistentCache {
  const file = cachePath(home);
  let map = loadMap(file);
  let dirty = false;
  // files are keyed relative to `home`, so the cache survives the home
  // directory moving or being referenced through a different absolute path
  const relKey = (f: string): string => path.relative(home, f).split(path.sep).join('/');
  const countEvents = (v: unknown): number => {
    const events = (v as { events?: unknown })?.events;
    return Array.isArray(events) ? events.length : 0;
  };

  return {
    get(f, key) {
      const hit = map[relKey(f)];
      return hit && hit.key === key ? hit.value : null;
    },
    put(f, key, value) {
      const rk = relKey(f);
      const hit = map[rk];
      if (hit && hit.key === key) return;
      map[rk] = { key, value };
      dirty = true;
    },
    flush() {
      if (!dirty) return;
      dirty = false;
      let total = 0;
      for (const entry of Object.values(map)) total += countEvents(entry.value);
      if (total > MAX_CACHED_EVENTS) return;
      try {
        mkdirSync(path.dirname(file), { recursive: true });
        const tmp = file + '.tmp';
        writeFileSync(tmp, JSON.stringify({ version: CACHE_VERSION, files: map }), 'utf8');
        renameSync(tmp, file);
      } catch {
        /* cache is best-effort */
      }
    },
    cachedFiles() {
      return Object.keys(map).length;
    },
  };
}

function loadMap(file: string): CacheMap {
  if (!existsSync(file)) return {};
  try {
    const doc = JSON.parse(readFileSync(file, 'utf8')) as { version?: number; files?: CacheMap };
    if (!doc || doc.version !== CACHE_VERSION || !doc.files || typeof doc.files !== 'object') return {};
    const out: CacheMap = {};
    for (const [k, v] of Object.entries(doc.files)) {
      if (v && typeof v.key === 'string' && (Array.isArray(v.value) || (v.value && typeof v.value === 'object'))) {
        out[k] = { key: v.key, value: v.value };
      }
    }
    return out;
  } catch {
    return {};
  }
}
