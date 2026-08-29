import { AgentId, UsageEvent } from '../types.js';
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
}

export const adapters = [claudeAdapter, codexAdapter, geminiAdapter] as const;

type Adapter = (typeof adapters)[number];

export async function scanAdapter(a: Adapter, home: string): Promise<AdapterOut> {
  return (await a.scan(home)) as AdapterOut;
}
