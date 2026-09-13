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
  const clean = s.replace(/\x1b\[[0-9;]*m/g, '');
  let width = 0;
  for (const ch of clean) {
    const cp = ch.codePointAt(0) ?? 0;
    width += isWide(cp) ? 2 : 1;
  }
  return width;
}

/** East Asian Wide / Fullwidth code points render two cells wide in terminals. */
function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0xa4cf) || // CJK radicals .. Yi syllables
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compatibility ideographs
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK compatibility forms
    (cp >= 0xff00 && cp <= 0xff60) || // fullwidth forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x3fffd) // CJK ext B..
  );
}

export function fmtInt(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function fmtCost(n: number): string {
  return '$' + n.toFixed(2);
}

/** Compact human duration for countdowns, e.g. "1h 12m" or "4d 3h". */
export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'now';
  const minutes = Math.round(ms / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return hours ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
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
