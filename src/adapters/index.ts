import { AgentId, ParsedFile, RateLimitSnapshot, UsageEvent } from '../types.js';
import { PersistentCache } from '../cache.js';
import { claudeAdapter } from './claude.js';
import { codexAdapter } from './codex.js';
import { geminiAdapter } from './gemini.js';

export interface AdapterOut {
  agent: AgentId;
  root: string;
  exists: boolean;
  files: number;
  events: UsageEvent[];
  notes: string[];
  /** newest rate-limit snapshot found in this agent's logs, if any */
  limits?: RateLimitSnapshot[];
}

export const adapters = [claudeAdapter, codexAdapter, geminiAdapter] as const;

type Adapter = (typeof adapters)[number];

export async function scanAdapter(a: Adapter, home: string, cache?: PersistentCache): Promise<AdapterOut> {
  return (await a.scan(home, cache)) as AdapterOut;
}

export type { ParsedFile };
