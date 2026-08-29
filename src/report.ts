import { agentRows, dayKey, modelRows, monthKey, sessionRows, totalsOf } from './aggregate.js';
import { fmtCost, fmtInt } from './format.js';
import { budgetStatus } from './budget.js';
import { totalTokens, UsageEvent, Config } from './types.js';

export interface ReportOptions {
  since?: string;
  until?: string;
  month?: string;
}

/** Build a standalone markdown report for a filtered set of events. */
export function buildReport(events: UsageEvent[], cfg: Config, opts: ReportOptions = {}): string {
  const totals = totalsOf(events, cfg);
  const lines: string[] = [];

  lines.push('# agentstats report');
  lines.push('');
  const period = [opts.since, opts.until].filter(Boolean).join(' ~ ') || opts.month || 'all time';
  lines.push(`- Period: **${period}** (local time)`);
  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push(
    `- Totals: **${fmtInt(totalTokens(totals))} tokens** across ${fmtInt(totals.events)} events, ` +
      `estimated cost **${fmtCost(totals.cost)}**`
  );
  lines.push('');

  lines.push('## Daily');
  lines.push('');
  lines.push('| Date | Input | Output | Cache W | Cache R | Total | Cost (USD) |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|');
  const byDay = new Map<string, UsageEvent[]>();
  for (const e of events) {
    const k = dayKey(e.ts);
    (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(e);
  }
  for (const day of [...byDay.keys()].sort()) {
    const t = totalsOf(byDay.get(day)!, cfg);
    lines.push(
      `| ${day} | ${fmtInt(t.input)} | ${fmtInt(t.output)} | ${fmtInt(t.cacheWrite5m + t.cacheWrite1h)} | ${fmtInt(t.cacheRead)} | ${fmtInt(totalTokens(t))} | ${t.cost.toFixed(4)} |`
    );
  }
  lines.push('');

  lines.push('## By model');
  lines.push('');
  lines.push('| Model | Input | Output | Cache | Total | Cost (USD) |');
  lines.push('|---|---:|---:|---:|---:|---:|');
  for (const m of modelRows(events, cfg)) {
    const cache = m.totals.cacheRead + m.totals.cacheWrite5m + m.totals.cacheWrite1h;
    lines.push(
      `| ${m.model}${m.priced ? '' : ' (unpriced)'} | ${fmtInt(m.totals.input)} | ${fmtInt(m.totals.output)} | ${fmtInt(cache)} | ${fmtInt(totalTokens(m.totals))} | ${m.totals.cost.toFixed(4)} |`
    );
  }
  lines.push('');

  lines.push('## By agent');
  lines.push('');
  lines.push('| Agent | Sessions | Tokens | Cost (USD) |');
  lines.push('|---|---:|---:|---:|');
  for (const a of agentRows(events, cfg)) {
    lines.push(`| ${a.agent} | ${fmtInt(a.sessions)} | ${fmtInt(totalTokens(a.totals))} | ${a.totals.cost.toFixed(4)} |`);
  }
  lines.push('');

  lines.push('## Top sessions');
  lines.push('');
  lines.push('| Session | Date | Agent | Project | Tokens | Cost (USD) |');
  lines.push('|---|---|---|---|---:|---:|');
  for (const s of sessionRows(events, cfg).slice(0, 15)) {
    lines.push(
      `| \`${s.session.slice(0, 12)}\` | ${s.date} | ${s.agent} | ${s.project} | ${fmtInt(totalTokens(s.totals))} | ${s.totals.cost.toFixed(4)} |`
    );
  }
  lines.push('');

  const b = budgetStatus(events, cfg, opts.month);
  if (b) {
    lines.push('## Budget');
    lines.push('');
    lines.push(`Month ${b.month}: **${fmtCost(b.spend)}** of ${fmtCost(b.budget)} (${b.usedPct.toFixed(0)}%), projected ${fmtCost(b.projected)}.`);
    lines.push('');
  }

  lines.push('> Costs are estimates computed from public API list prices and locally recorded');
  lines.push('> token counts. Subscription plans (Pro/Max) are not billed per token.');
  lines.push('');

  return lines.join('\n');
}
