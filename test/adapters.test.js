import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanAll } from '../dist/scan.js';
import { totalsOf, filterEvents } from '../dist/aggregate.js';
import { loadConfig } from '../dist/config.js';
import { fixturesHome } from './helpers.js';

// fixture config pins prices for the fixture models, so the expected cost
// below stays valid no matter when the bundled table was last auto-refreshed
const cfg = loadConfig(fixturesHome);

const EXPECTED_TOTAL = 0.0165855;

test('scanAll collects events from all three agents', async () => {
  const { events, sources } = await scanAll(fixturesHome);
  assert.equal(events.length, 7);
  assert.equal(sources.length, 3);
  assert.deepEqual(sources.map((s) => s.agent).sort(), ['claude', 'codex', 'gemini']);
});

test('claude adapter dedupes retried messages and splits cache writes', async () => {
  const { events } = await scanAll(fixturesHome);
  const claude = events.filter((e) => e.agent === 'claude');
  assert.equal(claude.length, 4); // msg_1 duplicate dropped
  const s1 = claude.find((e) => e.sessionId === 's1');
  assert.ok(s1);
  assert.equal(s1.project, 'C--code-web');
  assert.equal(s1.input, 1000);
  assert.equal(s1.cacheRead, 2000);
  assert.equal(s1.cacheWrite5m, 500);
  assert.equal(s1.output, 300);
  const s2 = claude.find((e) => e.sessionId === 's2');
  assert.equal(s2.cacheWrite5m, 40);
  assert.equal(s2.cacheWrite1h, 10);
});

test('codex adapter turns cumulative totals into deltas', async () => {
  const { events } = await scanAll(fixturesHome);
  const codex = events.filter((e) => e.agent === 'codex');
  assert.equal(codex.length, 2);
  assert.equal(codex[0].model, 'gpt-5.6-luna');
  assert.equal(codex[0].project, 'web');
  assert.equal(codex[0].input, 600); // 1000 - 400 cached
  assert.equal(codex[0].cacheRead, 400);
  assert.equal(codex[0].output, 200);
  assert.equal(codex[1].input, 1500); // delta 2000 - 500
  assert.equal(codex[1].cacheRead, 500);
  assert.equal(codex[1].output, 300);
});

test('gemini adapter walks session JSON for usageMetadata', async () => {
  const { events } = await scanAll(fixturesHome);
  const gemini = events.filter((e) => e.agent === 'gemini');
  assert.equal(gemini.length, 1);
  assert.equal(gemini[0].model, 'gemini-2.5-pro');
  assert.equal(gemini[0].input, 800); // 1000 - 200 cached
  assert.equal(gemini[0].cacheRead, 200);
  assert.equal(gemini[0].output, 150); // 100 candidates + 50 thinking
  assert.equal(gemini[0].project, 'web'); // resolved from .project_root
});

test('cost math matches hand-computed fixture totals', async () => {
  const { events } = await scanAll(fixturesHome);
  const t = totalsOf(events, cfg);
  assert.ok(Math.abs(t.cost - EXPECTED_TOTAL) < 1e-9, `cost ${t.cost} != ${EXPECTED_TOTAL}`);
  assert.equal(t.events, 7);
});

test('filterEvents narrows by project', async () => {
  const { events } = await scanAll(fixturesHome);
  assert.equal(filterEvents(events, { project: 'other' }).length, 1);
  assert.equal(filterEvents(events, { since: '2026-08-21', until: '2026-08-21' }).length, 2);
});
