import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { scanAll } from '../dist/scan.js';
import { totalsOf, filterEvents } from '../dist/aggregate.js';
import { loadConfig } from '../dist/config.js';
import { fixturesHome, tmpHome } from './helpers.js';

// fixture config pins prices for the fixture models, so the expected cost
// below stays valid no matter when the bundled table was last auto-refreshed
const cfg = loadConfig(fixturesHome);

const EXPECTED_TOTAL = 0.01983275;

test('scanAll collects events from all three agents', async () => {
  const { events, sources } = await scanAll(fixturesHome);
  assert.equal(events.length, 13);
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
  const codex = events.filter((e) => e.agent === 'codex' && e.sessionId === 'cx1');
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

test('codex adapter prefers token_usage_record over token_count duplicates', async () => {
  const { events } = await scanAll(fixturesHome);
  // fixture emits the same two responses as token_usage_record AND as
  // token_count lines; only the records may be counted
  const sessA = events.filter((e) => e.agent === 'codex' && e.sessionId === 'sess-a');
  assert.equal(sessA.length, 2);
  assert.equal(sessA[0].input, 600);
  assert.equal(sessA[0].cacheRead, 400);
  assert.equal(sessA[0].output, 200);
  assert.equal(sessA[1].input, 1500);
  assert.equal(sessA[1].cacheRead, 500);
  assert.equal(sessA[1].output, 300);
  assert.equal(sessA[0].model, 'gpt-5.6-luna');
  assert.equal(sessA[0].project, 'web');
});

test('codex adapter skips re-broadcast last_token_usage payloads', async () => {
  const { events } = await scanAll(fixturesHome);
  // second token_count line repeats the identical last_token_usage of the
  // first (turn-end re-broadcast) and must not produce a second event
  const sessB = events.filter((e) => e.agent === 'codex' && e.sessionId === 'sess-b');
  assert.equal(sessB.length, 2);
  assert.equal(sessB[0].input, 600);
  assert.equal(sessB[1].input, 1500);
});

test('gemini adapter walks session JSON for usageMetadata', async () => {
  const { events } = await scanAll(fixturesHome);
  const g1 = events.find((e) => e.agent === 'gemini' && e.sessionId === 'g1');
  assert.ok(g1);
  assert.equal(g1.model, 'gemini-2.5-pro');
  assert.equal(g1.input, 800); // 1000 - 200 cached
  assert.equal(g1.cacheRead, 200);
  assert.equal(g1.output, 150); // 100 candidates + 50 thinking
  assert.equal(g1.project, 'web'); // resolved from .project_root
});

test('gemini JSONL sessions get timestamps (mtime fallback, never epoch 0)', async () => {
  const { events } = await scanAll(fixturesHome);
  const g2 = events.filter((e) => e.agent === 'gemini' && e.sessionId.includes('g2'));
  assert.equal(g2.length, 2);
  for (const e of g2) assert.ok(e.ts > 0, 'JSONL events must not fall back to epoch 0');
  const pro = g2.find((e) => e.model === 'gemini-2.5-pro');
  assert.equal(pro.input, 400); // 500 - 100 cached
  assert.equal(pro.output, 50); // 40 candidates + 10 thinking
  assert.equal(pro.model, 'gemini-2.5-pro');
});

test('gemini JSONL lines without a timestamp inherit the file mtime', async () => {
  const home = tmpHome();
  try {
    const chats = path.join(home, '.gemini', 'tmp', 'mtimetest01', 'chats');
    mkdirSync(chats, { recursive: true });
    writeFileSync(
      path.join(chats, 'session-2026-08-21T14-00-00-m1.jsonl'),
      JSON.stringify({ type: 'gemini', model: 'gemini-2.5-pro', usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 } }) + '\n'
    );
    const { events } = await scanAll(home);
    const e = events.find((ev) => ev.agent === 'gemini' && ev.sessionId.includes('m1'));
    assert.ok(e, 'event parsed');
    assert.ok(e.ts > 0, 'mtime fallback must not be epoch 0');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('cost math matches hand-computed fixture totals', async () => {
  const { events } = await scanAll(fixturesHome);
  const t = totalsOf(events, cfg);
  assert.ok(Math.abs(t.cost - EXPECTED_TOTAL) < 1e-9, `cost ${t.cost} != ${EXPECTED_TOTAL}`);
  assert.equal(t.events, 13);
});

test('filterEvents narrows by project', async () => {
  const { events } = await scanAll(fixturesHome);
  assert.equal(filterEvents(events, { project: 'other' }).length, 1);
  // day 2026-08-21: s2, s3, both sess-a records, both g2 lines
  assert.equal(filterEvents(events, { since: '2026-08-21', until: '2026-08-21' }).length, 6);
});

test('persistent scan cache survives process boundaries and invalidates on change', async () => {
  const home = tmpHome();
  try {
    const first = await scanAll(home); // cold: parses, writes disk cache
    assert.ok(first.cache?.enabled);
    const cachedFiles = first.cache.files;
    assert.ok(cachedFiles > 0);

    // second scan in the same process: identical events (disk/in-proc hit)
    const second = await scanAll(home);
    assert.equal(second.events.length, first.events.length);
    assert.deepEqual(totalsOf(second.events, cfg), totalsOf(first.events, cfg));

    // append a new usage line to a claude transcript; the size/mtime change
    // must invalidate the cache so the new event shows up
    const file = path.join(home, '.claude', 'projects', 'C--code-web', 's1.jsonl');
    appendFileSync(
      file,
      JSON.stringify({
        type: 'assistant',
        sessionId: 's1',
        requestId: 'req_new',
        timestamp: '2026-08-20T11:00:00.000Z',
        message: {
          id: 'msg_new',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-4-5',
          usage: { input_tokens: 111, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 22 },
        },
      }) + '\n'
    );
    utimesSync(file, new Date(), new Date());

    const third = await scanAll(home);
    assert.equal(third.events.length, first.events.length + 1);
    const added = third.events.find((e) => e.model === 'claude-sonnet-4-5' && e.input === 111 && e.output === 22);
    assert.ok(added, 'appended event should appear after cache invalidation');

    // cache file actually landed on disk in the config dir
    assert.ok(existsSync(path.join(home, '.agentstats', 'scan-cache-v1.json')));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('AGENTSTATS_NO_CACHE=1 skips the persistent cache entirely', async () => {
  const home = tmpHome();
  try {
    process.env.AGENTSTATS_NO_CACHE = '1';
    const { cache } = await scanAll(home);
    assert.equal(cache, undefined);
    assert.equal(existsSync(path.join(home, '.agentstats', 'scan-cache-v1.json')), false);
  } finally {
    delete process.env.AGENTSTATS_NO_CACHE;
    rmSync(home, { recursive: true, force: true });
  }
});

test('scan cache serves unchanged files and picks up appended events', async () => {
  const home = tmpHome();
  try {
    const first = await scanAll(home);
    assert.ok(first.events.length > 0);

    // second scan: same result, served from the mtime+size cache
    const second = await scanAll(home);
    assert.equal(second.events.length, first.events.length);
    assert.equal(totalsOf(second.events, cfg).cost, totalsOf(first.events, cfg).cost);

    // append a new usage line to a claude transcript; the size/mtime change
    // must invalidate the cache so the new event shows up
    const file = path.join(home, '.claude', 'projects', 'C--code-web', 's1.jsonl');
    appendFileSync(
      file,
      JSON.stringify({
        type: 'assistant',
        sessionId: 's1',
        requestId: 'req_new',
        timestamp: '2026-08-20T11:00:00.000Z',
        message: {
          id: 'msg_new',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-4-5',
          usage: { input_tokens: 111, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 22 },
        },
      }) + '\n'
    );
    utimesSync(file, new Date(), new Date());

    const third = await scanAll(home);
    assert.equal(third.events.length, first.events.length + 1);
    const added = third.events.find((e) => e.model === 'claude-sonnet-4-5' && e.input === 111 && e.output === 22);
    assert.ok(added, 'appended event should appear after cache invalidation');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
