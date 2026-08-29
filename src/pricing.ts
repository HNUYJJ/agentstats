import { Config, ModelPrice, UsageEvent } from './types.js';

/**
 * Bundled price table, USD per 1M tokens: [input, cachedInput, output].
 *
 * Sources (checked 2026-08): anthropic.com/news/claude-opus-4-8,
 * openai.com/index/gpt-5-6/, Google Gemini pricing pages.
 * Cached prices follow each provider's public cached-input discount.
 * Corrections are very welcome — prices live in one flat table and can also
 * be overridden per model via `pricingOverrides` in the config file.
 */
const PRICES: Record<string, ModelPrice> = {
  // --- Anthropic Claude (cache read = 0.1x input) ---
  'claude-fable-5': { input: 10, cachedInput: 1, output: 50 },
  'claude-opus-5': { input: 5, cachedInput: 0.5, output: 25 },
  'claude-opus-4-8': { input: 5, cachedInput: 0.5, output: 25 },
  'claude-opus-4-5': { input: 5, cachedInput: 0.5, output: 25 },
  'claude-opus-4-1': { input: 15, cachedInput: 1.5, output: 75 },
  'claude-opus-4': { input: 15, cachedInput: 1.5, output: 75 },
  'claude-opus': { input: 15, cachedInput: 1.5, output: 75 },
  'claude-sonnet-5': { input: 2, cachedInput: 0.2, output: 10 },
  'claude-sonnet-4-6': { input: 3, cachedInput: 0.3, output: 15 },
  'claude-sonnet-4-5': { input: 3, cachedInput: 0.3, output: 15 },
  'claude-sonnet-4': { input: 3, cachedInput: 0.3, output: 15 },
  'claude-sonnet-3-7': { input: 3, cachedInput: 0.3, output: 15 },
  'claude-sonnet': { input: 3, cachedInput: 0.3, output: 15 },
  'claude-haiku-4-5': { input: 1, cachedInput: 0.1, output: 5 },
  'claude-haiku': { input: 1, cachedInput: 0.1, output: 5 },
  'claude-3-5-haiku': { input: 0.8, cachedInput: 0.08, output: 4 },
  'claude-3-5-sonnet': { input: 3, cachedInput: 0.3, output: 15 },
  'claude-3-opus': { input: 15, cachedInput: 1.5, output: 75 },
  'claude-3-haiku': { input: 0.25, cachedInput: 0.03, output: 1.25 },

  // --- OpenAI GPT-5.x family / Codex models (cached = 0.1x input) ---
  'gpt-5-6-sol': { input: 5, cachedInput: 0.5, output: 30 },
  'gpt-5-6-terra': { input: 2, cachedInput: 0.2, output: 12 },
  'gpt-5-6-luna': { input: 0.2, cachedInput: 0.02, output: 1.2 },
  'gpt-5-5': { input: 5, cachedInput: 0.5, output: 30 },
  'gpt-5-4': { input: 2.5, cachedInput: 0.25, output: 15 },
  'gpt-5-4-nano': { input: 0.2, cachedInput: 0.02, output: 1.25 },
  'gpt-5-1-codex-max': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5-1-codex-mini': { input: 0.25, cachedInput: 0.025, output: 2 },
  'gpt-5-1-codex': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5-codex': { input: 1.25, cachedInput: 0.125, output: 10 },
  'codex-mini-latest': { input: 1.5, cachedInput: 0.375, output: 6 },
  'gpt-5-1': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5-mini': { input: 0.25, cachedInput: 0.025, output: 2 },
  'gpt-5-nano': { input: 0.05, cachedInput: 0.005, output: 0.4 },
  'gpt-4-1': { input: 2, cachedInput: 0.5, output: 8 },
  'gpt-4-1-mini': { input: 0.4, cachedInput: 0.1, output: 1.6 },
  'gpt-4-1-nano': { input: 0.1, cachedInput: 0.025, output: 0.4 },
  'gpt-4o': { input: 2.5, cachedInput: 1.25, output: 10 },
  'gpt-4o-mini': { input: 0.15, cachedInput: 0.075, output: 0.6 },
  'o3': { input: 2, cachedInput: 0.5, output: 8 },
  'o4-mini': { input: 1.1, cachedInput: 0.275, output: 4.4 },

  // --- Google Gemini (cached ~= 0.25x input for 2.5 family) ---
  'gemini-3-pro': { input: 2, cachedInput: 0.5, output: 12 },
  'gemini-2-5-pro': { input: 1.25, cachedInput: 0.3125, output: 10 },
  'gemini-2-5-flash': { input: 0.3, cachedInput: 0.075, output: 2.5 },
  'gemini-2-5-flash-lite': { input: 0.1, cachedInput: 0.025, output: 0.4 },
  'gemini-2-0-flash': { input: 0.1, cachedInput: 0.025, output: 0.4 },
};

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
export function listPriceRows(overrides?: Config['pricingOverrides'] | null): Array<{ model: string; source: 'bundled' | 'override' | 'overridden'; price: ModelPrice }> {
  const rows: Array<{ model: string; source: 'bundled' | 'override' | 'overridden'; price: ModelPrice }> = [];
  const seen = new Set<string>();
  if (overrides) {
    for (const k of Object.keys(overrides).sort()) {
      rows.push({ model: k, source: 'override', price: overrides[k] });
      seen.add(k);
    }
  }
  for (const k of Object.keys(PRICES).sort()) {
    rows.push({ model: k, source: seen.has(k) ? 'overridden' : 'bundled', price: PRICES[k] });
  }
  return rows;
}
