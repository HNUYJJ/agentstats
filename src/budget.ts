import { monthKey, totalsOf } from './aggregate.js';
import { dim, fmtCost, red, yellow } from './format.js';
import { Config, UsageEvent } from './types.js';

export interface BudgetStatus {
  month: string;
  spend: number;
  budget: number;
  usedPct: number;
  projected: number;
  level: 'ok' | 'warn' | 'over';
}

/** Current-month spend vs the configured budget. Null when no budget is set. */
export function budgetStatus(events: UsageEvent[], cfg: Config, month?: string): BudgetStatus | null {
  const budget = Number(cfg.budget);
  if (!Number.isFinite(budget) || budget <= 0) return null;
  const now = new Date();
  const mk = month ?? monthKey(now.getTime());
  const inMonth = events.filter((e) => monthKey(e.ts) === mk);
  const spend = totalsOf(inMonth, cfg).cost;
  const usedPct = (spend / budget) * 100;
  let projected = spend;
  if (mk === monthKey(now.getTime())) {
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    projected = now.getDate() > 0 ? (spend / now.getDate()) * days : spend;
  }
  const level: BudgetStatus['level'] = usedPct >= 100 ? 'over' : usedPct >= 80 ? 'warn' : 'ok';
  return { month: mk, spend, budget, usedPct, projected, level };
}

export function renderBudgetLine(s: BudgetStatus): string {
  const filled = Math.max(0, Math.min(10, Math.round((s.usedPct / 100) * 10)));
  const bar = '#'.repeat(filled) + '.'.repeat(10 - filled);
  const body =
    `Budget (${s.month}): ${fmtCost(s.spend)} of ${fmtCost(s.budget)} ` +
    `(${s.usedPct.toFixed(0)}%) [${bar}] projected ${fmtCost(s.projected)}`;
  return s.level === 'over' ? red(body) : s.level === 'warn' ? yellow(body) : dim(body);
}

export function budgetExitCode(s: BudgetStatus | null): number {
  return s && s.level === 'over' ? 2 : 0;
}
