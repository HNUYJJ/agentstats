import { dim, fmtDuration, renderTable, yellow, red } from './format.js';
import { RateLimitSnapshot, RateWindow } from './types.js';

/**
 * Codex records its own rate-limit windows (5-hour primary, weekly secondary)
 * alongside token counts in the local rollout logs - the same numbers the
 * official UI shows, but readable offline. Claude Code and Gemini CLI do not
 * record equivalent data, so this is currently Codex-only.
 */

export function windowLabel(w: RateWindow): string {
  if (w.windowMinutes >= 1440 && w.windowMinutes % 1440 === 0) return `${w.windowMinutes / 1440}d window`;
  if (w.windowMinutes % 60 === 0) return `${w.windowMinutes / 60}h window`;
  return `${w.windowMinutes}m window`;
}

/** 80%+ is nearly exhausted, 50%+ is getting close - matches the budget colors. */
export function usedLevel(usedPercent: number): 'ok' | 'warn' | 'over' {
  return usedPercent >= 80 ? 'over' : usedPercent >= 50 ? 'warn' : 'ok';
}

function colorize(level: 'ok' | 'warn' | 'over', text: string, enabled: boolean): string {
  if (!enabled) return text;
  return level === 'over' ? red(text) : level === 'warn' ? yellow(text) : text;
}

export function renderLimitsText(limits: RateLimitSnapshot[], opts: { colors?: boolean } = {}): string {
  const colors = opts.colors ?? true;
  const rows: string[][] = [];
  const now = Date.now();
  for (const snap of limits) {
    const windows = [snap.primary && { kind: 'primary', w: snap.primary }, snap.secondary && { kind: 'secondary', w: snap.secondary }].filter(
      Boolean
    ) as Array<{ kind: string; w: RateWindow }>;
    for (const { kind, w } of windows) {
      const level = usedLevel(w.usedPercent);
      const resetMs = w.resetsAt * 1000 - now;
      // a snapshot taken before the last reset reports a countdown that has
      // already elapsed; say so instead of a confusing "now"
      const resetCell = resetMs <= 0 ? dim('already reset') : colorize(level, fmtDuration(resetMs), colors);
      rows.push([
        snap.agent,
        kind,
        windowLabel(w),
        colorize(level, `${w.usedPercent.toFixed(0)}%`, colors),
        resetCell,
        snap.planType ?? dim('unknown'),
        dim(`snapshot ${fmtDuration(now - snap.ts)} ago`),
      ]);
    }
  }
  const table = renderTable(
    ['Agent', 'Window', 'Length', 'Used', 'Resets in', 'Plan', ''],
    rows,
    { aligns: ['l', 'l', 'l', 'r', 'r', 'l', 'l'] }
  );
  return [table, '', dim('read from local logs - the official client shows the same numbers online')].join('\n');
}
