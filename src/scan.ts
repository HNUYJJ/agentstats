import { AgentId, UsageEvent } from './types.js';
import { adapters, scanAdapter } from './adapters/index.js';

export interface SourceInfo {
  agent: AgentId;
  root: string;
  exists: boolean;
  files: number;
  events: number;
  latestTs: number;
  notes: string[];
}

export interface ScanResult {
  events: UsageEvent[];
  sources: SourceInfo[];
}

/** Scan every supported agent's local logs under `home`. */
export async function scanAll(home: string, only?: AgentId[]): Promise<ScanResult> {
  const events: UsageEvent[] = [];
  const sources: SourceInfo[] = [];
  for (const a of adapters) {
    if (only && !only.includes(a.id)) continue;
    const out = await scanAdapter(a, home);
    events.push(...out.events);
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
  return { events, sources };
}
