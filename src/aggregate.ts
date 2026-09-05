import { Config, Totals, UsageEvent, emptyTotals, totalTokens } from './types.js';
import { eventCost, priceFor } from './pricing.js';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local-time date key, e.g. 2026-08-29. */
export function dayKey(ts: number): string {
  if (!ts) return 'unknown';
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Local-time month key, e.g. 2026-08. */
export function monthKey(ts: number): string {
  if (!ts) return 'unknown';
  return dayKey(ts).slice(0, 7);
}

export interface EventFilter {
  since?: string;
  until?: string;
  project?: string;
  model?: string;
}

export function filterEvents(events: UsageEvent[], f: EventFilter): UsageEvent[] {
  return events.filter((e) => {
    if (f.since && dayKey(e.ts) < f.since) return false;
    if (f.until && dayKey(e.ts) > f.until) return false;
    if (f.project && !e.project.toLowerCase().includes(f.project.toLowerCase())) return false;
    if (f.model && !e.model.toLowerCase().includes(f.model.toLowerCase())) return false;
    return true;
  });
}

export function totalsOf(events: UsageEvent[], cfg?: Config | null): Totals {
  const t = emptyTotals();
  for (const e of events) {
    t.events++;
    t.input += e.input;
    t.cacheRead += e.cacheRead;
    t.cacheWrite5m += e.cacheWrite5m;
    t.cacheWrite1h += e.cacheWrite1h;
    t.output += e.output;
    const p = priceFor(e.model, cfg?.pricingOverrides);
    if (p) t.cost += eventCost(e, p);
  }
  return t;
}

export function groupBy<T>(items: T[], keyFn: (x: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = keyFn(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

export interface SessionRow {
  session: string;
  date: string;
  agent: string;
  project: string;
  model: string;
  modelCount: number;
  totals: Totals;
}

export function sessionRows(events: UsageEvent[], cfg?: Config | null): SessionRow[] {
  const rows: SessionRow[] = [];
  for (const [key, evs] of groupBy(events, (e) => `${e.agent}/${e.sessionId}`)) {
    const totals = totalsOf(evs, cfg);
    const first = evs.reduce((a, b) => (a.ts <= b.ts ? a : b));
    // dominant model = the one that cost the most within the session
    let dominant = first.model;
    let dominantCost = -1;
    for (const [model, list] of groupBy(evs, (e) => e.model)) {
      const c = totalsOf(list, cfg).cost;
      if (c > dominantCost) {
        dominantCost = c;
        dominant = model;
      }
    }
    rows.push({
      session: key.includes('/') ? key.slice(key.indexOf('/') + 1) : key,
      date: dayKey(first.ts),
      agent: first.agent,
      project: first.project,
      model: dominant,
      modelCount: new Set(evs.map((e) => e.model)).size,
      totals,
    });
  }
  rows.sort((a, b) => b.totals.cost - a.totals.cost);
  return rows;
}

export interface ModelRow {
  model: string;
  priced: boolean;
  totals: Totals;
}

export function modelRows(events: UsageEvent[], cfg?: Config | null): ModelRow[] {
  const rows: ModelRow[] = [];
  for (const [model, evs] of groupBy(events, (e) => e.model)) {
    rows.push({ model, priced: !!priceFor(model, cfg?.pricingOverrides), totals: totalsOf(evs, cfg) });
  }
  rows.sort((a, b) => b.totals.cost - a.totals.cost);
  return rows;
}

export interface AgentRow {
  agent: string;
  sessions: number;
  totals: Totals;
}

export function agentRows(events: UsageEvent[], cfg?: Config | null): AgentRow[] {
  const rows: AgentRow[] = [];
  for (const [agent, evs] of groupBy(events, (e) => e.agent)) {
    rows.push({
      agent,
      sessions: new Set(evs.map((e) => e.sessionId)).size,
      totals: totalsOf(evs, cfg),
    });
  }
  rows.sort((a, b) => b.totals.cost - a.totals.cost);
  return rows;
}

export interface ProjectRow {
  project: string;
  sessions: number;
  totals: Totals;
}

export function projectRows(events: UsageEvent[], cfg?: Config | null): ProjectRow[] {
  const rows: ProjectRow[] = [];
  for (const [project, evs] of groupBy(events, (e) => e.project)) {
    rows.push({
      project,
      sessions: new Set(evs.map((e) => e.sessionId)).size,
      totals: totalsOf(evs, cfg),
    });
  }
  rows.sort((a, b) => b.totals.cost - a.totals.cost);
  return rows;
}

/** Group events by a usage field, sub-groups sorted by cost (desc). */
export function groupByFieldSortedByCost(
  evs: UsageEvent[],
  field: 'model' | 'agent' | 'project',
  cfg?: Config | null
): Array<[string, UsageEvent[]]> {
  const map = new Map<string, UsageEvent[]>();
  for (const e of evs) {
    const k = String((e as unknown as Record<string, unknown>)[field] ?? 'unknown');
    (map.get(k) ?? map.set(k, []).get(k)!).push(e);
  }
  return [...map.entries()].sort((a, b) => totalsOf(b[1], cfg).cost - totalsOf(a[1], cfg).cost);
}

export { totalTokens };
