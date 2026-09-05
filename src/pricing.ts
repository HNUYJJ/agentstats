import { GENERATED_PRICES, GENERATED_SOURCES } from './prices.generated.js';
import { Config, ModelPrice, UsageEvent } from './types.js';

/**
 * Hand-curated prices. Wins over the auto-generated table; use this to pin a
 * price you have verified against the vendor, or to add models neither the
 * official pricing pages nor the community fallback know about. Note that pins
 * never auto-update — user config (pricingOverrides) wins over everything.
 */
const MANUAL_PRICES: Record<string, ModelPrice> = {
  // example:
  // 'codex-auto-review': { input: 1.25, cachedInput: 0.125, output: 10 },
};

/** Merged lookup table: generated (auto-refreshed) + manual pins. */
export const PRICES: Record<string, ModelPrice> = { ...GENERATED_PRICES, ...MANUAL_PRICES };

/** Canonicalize a raw model string so it can be matched against the table. */
export function normalizeModel(raw: string): string {
  let m = raw.toLowerCase().trim();
  const slash = m.lastIndexOf('/');
  if (slash >= 0) m = m.slice(slash + 1);
  // dotted vendor prefixes, e.g. "us.anthropic.claude-sonnet-4-5:beta"
  const dot = m.lastIndexOf('.');
  if (dot >= 0 && /^(claude|gpt|gemini|o\d|codex)/.test(m.slice(dot + 1))) {
    m = m.slice(dot + 1);
  }
  m = m.replace(/@[^@]*$/, ''); // region/variant qualifiers: claude-opus-4-8@default
  m = m.replace(/:[^:]*$/, '');
  m = m.replace(/-\d{8}$/, '');
  m = m.replace(/\./g, '-');
  return m;
}

function lookup(table: Record<string, ModelPrice>, m: string): ModelPrice | null {
  const exact = table[m];
  if (exact) return exact;
  let best: string | null = null;
  for (const k of Object.keys(table)) {
    if (m.startsWith(k) && (best === null || k.length > best.length)) best = k;
  }
  return best ? table[best] : null;
}

/** Resolve a price for a raw model string; null when unknown. */
export function priceFor(rawModel: string, overrides?: Config['pricingOverrides'] | null): ModelPrice | null {
  const m = normalizeModel(rawModel);
  if (overrides) {
    const hit = lookup(overrides, m);
    if (hit) return hit;
  }
  return lookup(PRICES, m);
}

/** Cost of one event in USD. Cache writes are Anthropic-style: 1.25x/2x input. */
export function eventCost(e: UsageEvent, p: ModelPrice): number {
  const cached = p.cachedInput ?? p.input * 0.1;
  return (
    e.input * p.input +
    e.cacheRead * cached +
    e.cacheWrite5m * p.input * 1.25 +
    e.cacheWrite1h * p.input * 2 +
    e.output * p.output
  ) / 1e6;
}

/** All bundled prices plus overrides, for the `pricing` command. */
export function listPriceRows(overrides?: Config['pricingOverrides'] | null): Array<{ model: string; source: 'official' | 'community' | 'manual' | 'override' | 'overridden'; price: ModelPrice }> {
  const rows: Array<{ model: string; source: 'official' | 'community' | 'manual' | 'override' | 'overridden'; price: ModelPrice }> = [];
  const seen = new Set<string>();
  if (overrides) {
    for (const k of Object.keys(overrides).sort()) {
      rows.push({ model: k, source: 'override', price: overrides[k] });
      seen.add(k);
    }
  }
  const manualKeys = new Set(Object.keys(MANUAL_PRICES));
  for (const k of Object.keys(PRICES).sort()) {
    const source = seen.has(k)
      ? 'overridden'
      : manualKeys.has(k)
        ? 'manual'
        : (GENERATED_SOURCES[k] ?? '').startsWith('official')
          ? 'official'
          : 'community';
    rows.push({ model: k, source, price: PRICES[k] });
  }
  return rows;
}
