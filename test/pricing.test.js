import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { normalizeModel, priceFor, eventCost, PRICES } from '../dist/pricing.js';
import { loadConfig } from '../dist/config.js';

test('normalizeModel strips provider prefixes, dots and date suffixes', () => {
  assert.equal(normalizeModel('anthropic/claude-3.5-sonnet-20241022'), 'claude-3-5-sonnet');
  assert.equal(normalizeModel('openai/gpt-5.6-luna'), 'gpt-5-6-luna');
  assert.equal(normalizeModel('CLAUDE-OPUS-4-8'), 'claude-opus-4-8');
  assert.equal(normalizeModel('codex-mini-latest'), 'codex-mini-latest');
  assert.equal(normalizeModel('us.anthropic.claude-sonnet-4-5:beta'), 'claude-sonnet-4-5');
  assert.equal(normalizeModel('claude-opus-4-8@default'), 'claude-opus-4-8');
  assert.equal(priceFor('claude-opus-4-8@default')?.input, priceFor('claude-opus-4-8')?.input);
});

// NOTE: assertions are deliberately value-free — the bundled table is
// auto-refreshed by a scheduled GitHub Action, so tests must not pin prices.
test('priceFor resolves known models to positive finite prices', () => {
  for (const raw of ['claude-opus-4-8', 'gpt-5.6-luna', 'gpt-5.1-codex-max', 'claude-sonnet-4-5-20250929', 'gemini-2.5-pro']) {
    const p = priceFor(raw);
    assert.ok(p, `no price found for ${raw}`);
    assert.ok(Number.isFinite(p.input) && p.input >= 0, `${raw}: bad input price`);
    assert.ok(Number.isFinite(p.output) && p.output >= 0, `${raw}: bad output price`);
  }
});

test('priceFor is stable for equivalent model spellings', () => {
  assert.deepEqual(priceFor('gpt-5-6-luna-20260801'), priceFor('gpt-5.6-luna'));
});

test('priceFor returns null for unknown models', () => {
  assert.equal(priceFor('mystery-model-x'), null);
});

test('priceFor honours pricingOverrides first', () => {
  const p = priceFor('gpt-5.6-luna', { 'gpt-5-6-luna': { input: 1, output: 2 } });
  assert.equal(p.input, 1);
  assert.equal(p.output, 2);
});

test('eventCost applies cache multipliers correctly', () => {
  // explicit price so this test is independent of table refreshes
  const sonnet = { input: 3, cachedInput: 0.3, output: 15 };
  const cost = eventCost(
    { agent: 'claude', sessionId: 's', project: 'p', model: 'claude-sonnet-4-5', ts: 0, input: 1000, cacheRead: 2000, cacheWrite5m: 500, cacheWrite1h: 0, output: 300 },
    sonnet
  );
  // 1000*3 + 2000*0.3 + 500*3.75 + 300*15 = 9975e-6
  assert.ok(Math.abs(cost - 0.009975) < 1e-9);
});

test('bundled table is normalized and well-formed', () => {
  const keys = Object.keys(PRICES);
  assert.ok(keys.length >= 40, `expected a substantial table, got ${keys.length}`);
  for (const family of ['claude-', 'gpt-', 'gemini-']) {
    assert.ok(keys.some((k) => k.startsWith(family)), `missing family ${family}`);
  }
  for (const [k, p] of Object.entries(PRICES)) {
    assert.equal(normalizeModel(k), k, `key ${k} is not in normalized form`);
    assert.ok(Number.isFinite(p.input) && p.input >= 0, `${k}: bad input`);
    assert.ok(Number.isFinite(p.output) && p.output >= 0, `${k}: bad output`);
  }
});

test('loadConfig drops invalid budget and pricing overrides instead of producing NaN', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agentstats-config-'));
  try {
    mkdirSync(path.join(dir, '.agentstats'), { recursive: true });
    writeFileSync(
      path.join(dir, '.agentstats', 'config.json'),
      JSON.stringify({
        budget: 'lots',
        pricingOverrides: {
          bad: { input: 'free', output: 2 },
          negative: { input: -1, output: 2 },
          good: { input: 1, cachedInput: 'nope', output: 2 },
        },
      }),
      'utf8'
    );
    const cfg = loadConfig(dir);
    assert.equal(cfg.budget, undefined);
    assert.deepEqual(Object.keys(cfg.pricingOverrides ?? {}), ['good']);
    assert.equal(cfg.pricingOverrides?.good.cachedInput, undefined); // invalid cached dropped
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
