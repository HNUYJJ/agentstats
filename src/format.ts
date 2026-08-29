let enabled = false;

export function setColors(on: boolean): void {
  enabled = on;
}

export function colorsEnabled(): boolean {
  return enabled;
}

function c(code: string, s: string): string {
  return enabled ? `\x1b[${code}m${s}\x1b[0m` : s;
}

export const bold = (s: string) => c('1', s);
export const dim = (s: string) => c('2', s);
export const green = (s: string) => c('32', s);
export const yellow = (s: string) => c('33', s);
export const red = (s: string) => c('31', s);
export const cyan = (s: string) => c('36', s);

export function visibleLen(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

export function fmtInt(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function fmtCost(n: number): string {
  return '$' + n.toFixed(2);
}

export interface TableOpts {
  aligns?: Array<'l' | 'r'>;
}

/** Minimal dependency-free table renderer. Cells may contain ANSI codes. */
export function renderTable(headers: string[], rows: string[][], opts: TableOpts = {}): string {
  const aligns = opts.aligns ?? headers.map((h, i) => (i === 0 ? 'l' : 'r'));
  const widths = headers.map((h, i) =>
    Math.max(visibleLen(h), ...rows.map((r) => visibleLen(r[i] ?? '')))
  );
  const pad = (cell: string, i: number) => {
    const w = widths[i] - visibleLen(cell);
    return aligns[i] === 'l' ? cell + ' '.repeat(w) : ' '.repeat(w) + cell;
  };
  const lines: string[] = [];
  lines.push(headers.map((h, i) => dim(bold(pad(h, i)))).join('  '));
  lines.push(dim(widths.map((w) => '-'.repeat(w)).join('  ')));
  for (const r of rows) lines.push(headers.map((_, i) => pad(r[i] ?? '', i)).join('  '));
  return lines.join('\n');
}
