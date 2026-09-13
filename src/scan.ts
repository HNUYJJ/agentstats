import { AgentId, RateLimitSnapshot, UsageEvent } from './types.js';
import { adapters, scanAdapter } from './adapters/index.js';
import { cacheDisabled, cachePath, openCache, PersistentCache } from './cache.js';

export interface SourceInfo {
  agent: AgentId;
  root: string;
  exists: boolean;
  files: number;
  events: number;
  latestTs: number;
  notes: string[];
}

export interface ScanCacheInfo {
  enabled: boolean;
  path: string;
  files: number;
}

export interface ScanResult {
  events: UsageEvent[];
  sources: SourceInfo[];
  /** newest rate-limit snapshot per agent that reports one (currently Codex) */
  limits: RateLimitSnapshot[];
  cache?: ScanCacheInfo;
}

/** Scan every supported agent's local logs under `home`. */
export async function scanAll(home: string, only?: AgentId[]): Promise<ScanResult> {
  const cache: PersistentCache | null = cacheDisabled() ? null : openCache(home);
  // adapters read disjoint directories, so they run concurrently
  const outs = await Promise.all(
    adapters.map(async (a) => ((only && !only.includes(a.id) ? null : await scanAdapter(a, home, cache ?? undefined))))
  );
  cache?.flush();

  const events: UsageEvent[] = [];
  const sources: SourceInfo[] = [];
  const limits: RateLimitSnapshot[] = [];
  for (const out of outs) {
    if (!out) continue;
    events.push(...out.events);
    if (out.limits?.length) limits.push(...out.limits);
    sources.push({
      agent: out.agent,
      root: out.root,
      exists: out.exists,
      files: out.files,
      events: out.events.length,
      latestTs: out.events.reduce((m, e) => Math.max(m, e.ts), 0),
      notes: out.notes,
    });
  }
  events.sort((x, y) => x.ts - y.ts);
  return {
    events,
    sources,
    limits,
    ...(cache ? { cache: { enabled: true, path: cachePath(home), files: cache.cachedFiles() } } : {}),
  };
}
