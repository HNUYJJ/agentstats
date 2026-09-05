#!/usr/bin/env node
// Regenerates src/prices.generated.ts from OFFICIAL vendor pricing pages.
//
// Precedence: official vendor pages win, a community database (LiteLLM) only
// fills models the official pages don't cover. Any source failure aborts the
// whole run (exit 1, nothing written) so prices are either fully fresh or
// untouched — never silently degraded to third-party data.
//
// Official sources and how they are parsed:
//   - Anthropic: the docs platform serves raw markdown at <url>.md; the
//     "## Model pricing" pipe table is parsed (verified 2026-08-29).
//   - OpenAI: developers.openai.com embeds structured table data in the page;
//     the "latest-pricing" (standard tier) region is parsed and Batch/Flex/
//     Priority tier rows are skipped (verified 2026-08-29).
//   - Google: ai.google.dev renders one pricing table per model section;
//     current promotional prices are taken and future scheduled prices are
//     ignored (verified 2026-08-29).
//
// These parsers read live vendor pages: when a vendor redesigns, this script
// fails loudly (by design) and needs its parser updated.
//
// Run manually:  node .github/scripts/update-prices.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

const SOURCES = [
  {
    id: 'official-anthropic',
    url: 'https://platform.claude.com/docs/en/about-claude/pricing.md',
    min: 6,
    parse: parseAnthropic,
  },
  {
    id: 'official-openai',
    url: 'https://developers.openai.com/api/docs/pricing',
    min: 6,
    parse: parseOpenAI,
  },
  {
    id: 'official-google',
    url: 'https://ai.google.dev/gemini-api/docs/pricing',
    min: 3,
    parse: parseGoogle,
  },
];
const COMMUNITY_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const COMMUNITY_ID = 'community-litellm';

/** Model families bundled in agentstats; everything else is skipped. */
const FAMILIES = /^(claude|gpt|gemini|codex-mini|o1|o3|o4)(-|$)/;
/** Google sections priced per-image/per-audio rather than per-token. */
const GOOGLE_DENY = /image|tts|live|veo|embedding|audio|robotics/;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_FILE = path.join(root, 'src', 'prices.generated.ts');

// Keep in exact sync with normalizeModel() in src/pricing.ts — the runtime
// looks models up with that function, so generated keys must already be in
// normalized form. A test asserts idempotence to catch drift.
function normalizeModel(raw) {
  let m = String(raw).toLowerCase().trim();
  const slash = m.lastIndexOf('/');
  if (slash >= 0) m = m.slice(slash + 1);
  const dot = m.lastIndexOf('.');
  if (dot >= 0 && /^(claude|gpt|gemini|o\d|codex)/.test(m.slice(dot + 1))) {
    m = m.slice(dot + 1);
  }
  m = m.replace(/:[^:]*$/, '');
  m = m.replace(/-\d{8}$/, '');
  m = m.replace(/\./g, '-');
  return m;
}

// --- Anthropic ---------------------------------------------------------------

/** "Claude Haiku 3.5" is spelled claude-3-5-haiku in the API, unlike 4.x+. */
function claudeDisplayToKey(display) {
  let k = display.toLowerCase().replace(/\s+/g, '-');
  k = k.replace(/^claude-([a-z]+)-3-(\d)$/, 'claude-3-$2-$1');
  return normalizeModel(k);
}

function parseUSD(s) {
  const m = String(s).match(/\$\s*([\d.]+)/);
  return m ? Number(m[1]) : null;
}

function parseAnthropic(md) {
  const secStart = md.indexOf('## Model pricing');
  if (secStart < 0) throw new Error('anthropic: "## Model pricing" section not found');
  const secEnd = md.indexOf('\n## ', secStart + 5);
  const section = md.slice(secStart, secEnd < 0 ? md.length : secEnd);

  const out = new Map();
  for (const line of section.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 6 || /^:?-{3,}/.test(cells[0]) || /^model$/i.test(cells[0])) continue;
    let name = cells[0]
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [text](link) -> text
      .replace(/\s*\([^)]*\)\s*/g, ' ') // annotations like "(retired, ...)"
      .replace(/\s+/g, ' ')
      .trim();
    if (!/^claude/i.test(name)) continue;
    const input = parseUSD(cells[1]);
    const cached = parseUSD(cells[4]);
    const output = parseUSD(cells[5]);
    if (input === null || output === null) continue;
    out.set(claudeDisplayToKey(name), {
      input,
      ...(cached !== null ? { cachedInput: cached } : {}),
      output,
    });
  }
  return out;
}

// --- OpenAI ------------------------------------------------------------------

function decodeEntities(s) {
  return s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function parseOpenAI(html) {
  const h = decodeEntities(html);
  const start = h.indexOf('content-switcher-latest-pricing');
  if (start < 0) throw new Error('openai: standard pricing switcher not found');
  // the switcher prefix is shared with unrelated component attributes
  // (content-switcher-root/-selector/...), so bound the region only on the
  // real section ids, which all end in "-pricing"
  let end = h.length;
  const swRe = /content-switcher-([a-z-]*pricing)/g;
  let sm;
  while ((sm = swRe.exec(h)) !== null) {
    if (sm.index <= start) continue;
    if (sm[1] !== 'latest-pricing') {
      end = sm.index;
      break;
    }
  }
  const region = h.slice(start, end);

  // tier markers (Standard/Batch/Flex/Priority sub-tabs) as string literals
  const markers = [];
  const tierRe = /\[0,"(standard|batch|flex|priority)"\]/gi;
  let m;
  while ((m = tierRe.exec(region)) !== null) markers.push([m.index, m[1].toLowerCase()]);
  // the first burst of markers is the tab list itself (all tiers within ~1.5k
  // chars); content markers follow one per tier section
  let tabListEnd = 0;
  for (let i = 1; i < markers.length; i++) {
    if (markers[i][0] - markers[i - 1][0] > 1500) break;
    tabListEnd = markers[i][0];
  }
  const contentMarkers = markers.filter(([pos]) => pos > tabListEnd);

  const out = new Map();
  const rowRe =
    /\[0,"([a-zA-Z0-9 .()<>\-]{3,60})"\],\[0,(-|"-"|[\d.]+)\],\[0,(-|"-"|[\d.]+)\],\[0,(-|"-"|[\d.]+)\],\[0,(-|"-"|[\d.]+)\]/g;
  // a dash cell (missing value) arrives as either - or "-", quoted or not
  const cell = (s) => (s === '-' || s === '"-"') ? null : Number(s);
  while ((m = rowRe.exec(region)) !== null) {
    let tier = 'standard';
    for (const [pos, t] of contentMarkers) if (pos < m.index) tier = t;
    if (tier !== 'standard') continue;
    const name = m[1].replace(/\s*\([^)]*\)\s*/g, ' ').trim(); // drop "(<272K context length)"
    const input = cell(m[2]);
    const cached = cell(m[3]);
    const output = cell(m[5]); // m[4] is the cache-write column
    if (input === null || output === null) continue;
    const key = normalizeModel(name);
    if (!FAMILIES.test(key)) continue;
    out.set(key, { input, ...(cached !== null ? { cachedInput: cached } : {}), output });
  }
  return out;
}

// --- Google ------------------------------------------------------------------

function htmlToText(s) {
  return decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function parseGoogle(html) {
  // headings up front: each model section has an h2 "Gemini ...", its tables
  // are preceded by tier h3s (Standard/Batch/Flex/Priority) that must be skipped
  const headings = [...html.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/g)].map((m) => ({
    pos: m.index,
    text: htmlToText(m[1]),
  }));

  const out = new Map();
  let idx = 0;
  while ((idx = html.indexOf('<table', idx)) !== -1) {
    const end = html.indexOf('</table>', idx);
    if (end < 0) break;
    const table = html.slice(idx, end + 8);
    idx = end;

    if (!table.includes('per 1M tokens')) continue;
    // nearest model-level heading before the table (tier h3s don't match)
    let display = null;
    for (let i = headings.length - 1; i >= 0; i--) {
      if (headings[i].pos >= idx && headings[i].text) continue;
      if (/^gemini\b/i.test(headings[i].text)) {
        display = headings[i].text;
        break;
      }
    }
    if (!display) continue;
    const key = normalizeModel(display.replace(/\s+/g, '-'));
    if (!FAMILIES.test(key) || GOOGLE_DENY.test(key)) continue;

    const rows = table.split('<tr').slice(1);
    let input = null;
    let cached = null;
    let output = null;
    for (const row of rows) {
      const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => htmlToText(c[1]));
      const label = (cells[0] || '').toLowerCase();
      const paid = cells.find((c) => /\$[\d.]+/.test(c) && !/^free/i.test(c));
      if (!paid) continue;
      const price = parseUSD(paid); // first $ value = current price, scheduled future prices ignored
      if (price === null) continue;
      if (label.startsWith('input price')) input = price;
      else if (label.startsWith('output price')) output = price;
      else if (label.startsWith('context caching')) cached = price;
    }
    if (input === null || output === null) continue;
    // first table per model = the Standard tier (Batch/Flex/Priority follow)
    if (!out.has(key)) {
      out.set(key, { input, ...(cached !== null ? { cachedInput: cached } : {}), output });
    }
  }
  return out;
}

// --- community fallback (gap filler) -----------------------------------------

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

const r6 = (x) => Math.round(x * 1e6) / 1e6;

function parseCommunity(db) {
  const candidates = new Map();
  for (const [rawId, info] of Object.entries(db)) {
    const key = normalizeModel(rawId);
    if (!FAMILIES.test(key)) continue;
    if (key.includes('@') || key.includes(' ')) continue; // region-qualified / malformed ids
    const input = num(info?.input_cost_per_token);
    const output = num(info?.output_cost_per_token);
    if (input === null || output === null) continue;
    const cached = num(info?.cache_read_input_token_cost);
    const list = candidates.get(key) ?? [];
    list.push({ rawId, input, output, cached, exact: rawId === key });
    candidates.set(key, list);
  }
  const out = new Map();
  for (const [key, list] of candidates) {
    list.sort(
      (a, b) =>
        Number(b.exact) - Number(a.exact) ||
        Number(b.cached !== null) - Number(a.cached !== null) ||
        a.rawId.localeCompare(b.rawId)
    );
    const w = list[0];
    out.set(key, {
      input: r6(w.input * 1e6),
      ...(w.cached !== null ? { cachedInput: r6(w.cached * 1e6) } : {}),
      output: r6(w.output * 1e6),
    });
  }
  return out;
}

// --- driver ------------------------------------------------------------------

async function fetchText(url) {
  // curl first: vendor edge rules can route Node's TLS fingerprint to a block
  // page even with a browser user-agent (observed with platform.claude.com),
  // while identical curl requests succeed. curl exists on all CI runners.
  try {
    const { stdout } = await execFileP(
      'curl',
      ['-sSL', '--max-time', '30', '-A', 'Mozilla/5.0', url],
      { maxBuffer: 64 * 1024 * 1024 }
    );
    if (stdout && stdout.length >= 500) return stdout;
    throw new Error(`curl returned only ${stdout ? stdout.length : 0} bytes`);
  } catch (curlErr) {
    const res = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`fetch failed: HTTP ${res.status} for ${url}`);
    const text = await res.text();
    if (!text || text.length < 500) throw new Error(`fetch failed: suspiciously small payload from ${url}`);
    return text;
  }
}

function parsePrevTable(text) {
  const match = text.match(/export const GENERATED_PRICES[^=]*= \{([\s\S]*)\n\};/);
  if (!match) return {};
  const table = {};
  for (const m of match[1].matchAll(/'([^']+)': \{([^}]*)\}/g)) {
    const entry = {};
    for (const field of m[2].matchAll(/(input|cachedInput|output): ([0-9.eE+-]+)/g)) {
      entry[field[1]] = Number(field[2]);
    }
    if (entry.input !== undefined && entry.output !== undefined) table[m[1]] = entry;
  }
  return table;
}

async function main() {
  const sections = [];
  for (const src of SOURCES) {
    const text = await fetchText(src.url);
    const map = src.parse(text);
    if (map.size < src.min) {
      throw new Error(`${src.id}: only ${map.size} models parsed (expected >= ${src.min}) — page layout changed?`);
    }
    sections.push({ id: src.id, url: src.url, map });
    console.log(`${src.id}: ${map.size} models`);
  }

  const table = {};
  const sources = {};
  for (const sec of sections) {
    for (const [k, v] of sec.map) {
      table[k] = v; // official wins over everything parsed earlier
      sources[k] = sec.id;
    }
  }

  // community database fills models the official pages do not cover
  try {
    const db = JSON.parse(await fetchText(COMMUNITY_URL));
    if (db && typeof db === 'object' && !Array.isArray(db)) {
      let filled = 0;
      for (const [k, v] of parseCommunity(db)) {
        if (!(k in table)) {
          table[k] = v;
          sources[k] = COMMUNITY_ID;
          filled++;
        }
      }
      console.log(`${COMMUNITY_ID}: +${filled} models not on official pages`);
    }
  } catch (err) {
    console.warn(`warning: community fallback unavailable (${err instanceof Error ? err.message : err}) — official sources only`);
  }

  validate(table, sources);

  const order = [...SOURCES.map((s) => s.id), COMMUNITY_ID];
  const groups = new Map(order.map((id) => [id, []]));
  for (const k of Object.keys(table).sort()) groups.get(sources[k]).push(k);

  const fetchedAt = new Date().toISOString();
  const body = [
    '// AUTO-GENERATED by .github/scripts/update-prices.mjs - DO NOT EDIT BY HAND.',
    `// Fetched: ${fetchedAt} - ${Object.keys(table).length} models. Prices are USD per 1M tokens.`,
    '// Official vendor pages take precedence; the LiteLLM community database only',
    '// fills models the official pages do not cover. To pin a verified price use',
    '// MANUAL_PRICES in src/pricing.ts (wins over this file) or pricingOverrides in',
    '// ~/.agentstats/config.json (wins over everything).',
    "import type { ModelPrice } from './types.js';",
    '',
    'export const GENERATED_PRICES: Record<string, ModelPrice> = {',
    ...order.flatMap((id) => {
      const keys = groups.get(id);
      if (!keys.length) return [];
      return [
        `  // --- ${id} (${keys.length} models) ---`,
        ...keys.map((k) => {
          const p = table[k];
          const cached = p.cachedInput !== undefined ? `cachedInput: ${p.cachedInput}, ` : '';
          return `  '${k}': { input: ${p.input}, ${cached}output: ${p.output} },`;
        }),
      ];
    }),
    '};',
    '',
    `// ISO timestamp of the fetch that produced this table.`,
    `export const GENERATED_AT = '${fetchedAt}';`,
    '',
    '/** Provenance per model key (official-anthropic | official-openai | official-google | community-litellm). */',
    'export const GENERATED_SOURCES: Record<string, string> = {',
    ...order.flatMap((id) => groups.get(id).map((k) => `  '${k}': '${id}',`)),
    '};',
    '',
  ];

  // change summary against the previous generated file
  let stats = '';
  if (existsSync(OUT_FILE)) {
    const prev = parsePrevTable(readFileSync(OUT_FILE, 'utf8'));
    const added = Object.keys(table).filter((k) => !(k in prev)).length;
    const changed = Object.keys(table).filter((k) => k in prev && JSON.stringify(prev[k]) !== JSON.stringify(table[k])).length;
    const removed = Object.keys(prev).filter((k) => !(k in table)).length;
    stats = ` (+${added} new, ~${changed} changed, -${removed} gone)`;
  }

  writeFileSync(OUT_FILE, body.join('\n'));
  console.log(`updated src/prices.generated.ts: ${Object.keys(table).length} models${stats}, fetched ${fetchedAt}`);
}

function validate(table, sources) {
  const keys = Object.keys(table);
  const fail = (msg) => {
    throw new Error(`validation failed, NOT writing: ${msg}`);
  };
  if (keys.length < 40) fail(`only ${keys.length} models in merged table`);
  for (const family of ['claude-', 'gpt-', 'gemini-']) {
    if (!keys.some((k) => k.startsWith(family))) fail(`no models found for family '${family}'`);
  }
  for (const k of keys) {
    if (normalizeModel(k) !== k) fail(`key '${k}' is not in normalized form (normalization drift?)`);
    const p = table[k];
    if (![p.input, p.output].every((v) => Number.isFinite(v) && v >= 0) ||
        (p.cachedInput !== undefined && !(Number.isFinite(p.cachedInput) && p.cachedInput >= 0))) {
      fail(`model '${k}' has a non-finite or negative price: ${JSON.stringify(p)} (source: ${sources[k]})`);
    }
  }
  // a refresh that drops >30% of previously known models is suspicious
  if (existsSync(OUT_FILE)) {
    const prevKeys = Object.keys(parsePrevTable(readFileSync(OUT_FILE, 'utf8')));
    if (prevKeys.length > 0) {
      const gone = prevKeys.filter((k) => !(k in table));
      if (gone.length > prevKeys.length * 0.3) {
        fail(`${gone.length}/${prevKeys.length} previously known models disappeared from the sources`);
      }
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
