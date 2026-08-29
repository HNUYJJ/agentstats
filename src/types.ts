export type AgentId = 'claude' | 'codex' | 'gemini';

export const AGENT_IDS: AgentId[] = ['claude', 'codex', 'gemini'];

/** One normalized token-usage observation extracted from an agent's local logs. */
export interface UsageEvent {
  agent: AgentId;
  sessionId: string;
  project: string;
  /** raw model string as recorded by the agent */
  model: string;
  /** epoch ms; day/month bucketing uses local time */
  ts: number;
  /** input tokens billed at full price (cached tokens excluded) */
  input: number;
  cacheRead: number;
  /** 5-minute TTL cache writes (Claude: billed at 1.25x input) */
  cacheWrite5m: number;
  /** 1-hour TTL cache writes (Claude: billed at 2x input) */
  cacheWrite1h: number;
  output: number;
}

export interface Totals {
  events: number;
  input: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  output: number;
  cost: number;
}

export function emptyTotals(): Totals {
  return { events: 0, input: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, output: 0, cost: 0 };
}

export function totalTokens(t: Pick<Totals, 'input' | 'cacheRead' | 'cacheWrite5m' | 'cacheWrite1h' | 'output'>): number {
  return t.input + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h + t.output;
}

export interface ModelPrice {
  /** USD per 1M input tokens */
  input: number;
  /** USD per 1M cached input tokens; defaults to 10% of input */
  cachedInput?: number;
  /** USD per 1M output tokens */
  output: number;
}

export interface Config {
  /** monthly USD budget; warnings at 80%, exit code 2 past 100% */
  budget?: number;
  /** user-supplied price fixes, keyed by normalized model name */
  pricingOverrides?: Record<string, ModelPrice>;
}
