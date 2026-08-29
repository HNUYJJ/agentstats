import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeModel, priceFor, eventCost } from '../dist/pricing.js';

test('normalizeModel strips provider prefixes, dots and date suffixes', () => {
  assert.equal(normalizeModel('anthropic/claude-3.5-sonnet-20241022'), 'claude-3-5-sonnet');
  assert.equal(normalizeModel('openai/gpt-5.6-luna'), 'gpt-5-6-luna');
  assert.equal(normalizeModel('CLAUDE-OPUS-4-8'), 'claude-opus-4-8');
  assert.equal(normalizeModel('codex-mini-latest'), 'codex-mini-latest');
  assert.equal(normalizeModel('us.anthropic.claude-sonnet-4-5:beta'), 'claude-sonnet-4-5');
});

test('priceFor resolves exact and prefix matches', () => {
  assert.equal(priceFor('claude-opus-4-8').output, 25);
  assert.equal(priceFor('claude-opus-4-8').input, 5);
  assert.equal(priceFor('openai/gpt-5.6-luna').input, 0.2);
  assert.equal(priceFor('gpt-5.1-codex-max').input, 1.25);
  // longest prefix wins over shorter families
  assert.equal(priceFor('gpt-5-6-luna-20260801').input, 0.2);
  assert.equal(priceFor('claude-sonnet-4-5-20250929').input, 3);
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
  const sonnet = priceFor('claude-sonnet-4-5');
  const cost = eventCost(
    { agent: 'claude', sessionId: 's', project: 'p', model: 'claude-sonnet-4-5', ts: 0, input: 1000, cacheRead: 2000, cacheWrite5m: 500, cacheWrite1h: 0, output: 300 },
    sonnet
  );
  // 1000*3 + 2000*0.3 + 500*3.75 + 300*15 = 9975e-6
  assert.ok(Math.abs(cost - 0.009975) < 1e-9);
});
