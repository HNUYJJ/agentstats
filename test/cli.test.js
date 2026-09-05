import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { currentMonth, fixturesHome, runCli, tmpHome } from './helpers.js';

const EXPECTED_TOTAL = 0.0165855;

test('daily --json matches fixture totals', () => {
  const r = runCli(['daily', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.rows.length, 3);
  assert.equal(out.rows[0].date, '2026-08-20');
  assert.ok(Math.abs(out.totals.costUsd - EXPECTED_TOTAL) < 1e-9);
  assert.equal(out.totals.totalTokens, 1000 + 500 + 2000 + 300 + 100 + 40 + 10 + 50 + 7 + 3 + 500 + 100 + 80 + 600 + 400 + 200 + 1500 + 500 + 300 + 800 + 200 + 150);
});

test('daily --breakdown model adds a model column', () => {
  const r = runCli(['daily', '--breakdown', 'model', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  const day20 = out.rows.filter((row) => row.date === '2026-08-20');
  assert.deepEqual(day20.map((row) => row.model).sort(), ['claude-sonnet-4-5', 'gpt-5.6-luna']);
});

test('monthly --json groups by month', () => {
  const r = runCli(['monthly', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].month, '2026-08');
});

test('models --json flags unpriced models', () => {
  const r = runCli(['models', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const rows = JSON.parse(r.stdout);
  const mystery = rows.find((row) => row.model === 'mystery-model-x');
  assert.ok(mystery);
  assert.equal(mystery.priced, false);
  assert.equal(mystery.costUsd, 0);
  const sonnet = rows.find((row) => row.model === 'claude-sonnet-4-5');
  assert.equal(sonnet.priced, true);
});

test('session --json ranks top spenders first', () => {
  const r = runCli(['session', '--json', '--limit', '0']);
  assert.equal(r.status, 0, r.stderr);
  const rows = JSON.parse(r.stdout);
  assert.equal(rows.length, 6);
  assert.equal(rows[0].session, 's1');
  assert.equal(rows[0].agent, 'claude');
  assert.ok(rows[0].costUsd >= rows[rows.length - 1].costUsd);
});

test('agents --json lists all three agents', () => {
  const r = runCli(['agents', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const rows = JSON.parse(r.stdout);
  assert.deepEqual(rows.map((row) => row.agent).sort(), ['claude', 'codex', 'gemini']);
});

test('doctor --json reports sources and gemini note', () => {
  const r = runCli(['doctor', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.sources.length, 3);
  const gemini = out.sources.find((s) => s.agent === 'gemini');
  assert.equal(gemini.events, 1);
});

test('report writes markdown to a file', () => {
  const home = tmpHome();
  try {
    const out = path.join(home, 'report.md');
    const r = runCli(['report', '--out', out, '--since', '2026-08-01'], home);
    assert.equal(r.status, 0, r.stderr);
    const md = readFileSync(out, 'utf8');
    assert.ok(md.startsWith('# agentstats report'));
    assert.ok(md.includes('claude-sonnet-4-5'));
    assert.ok(md.includes('## By agent'));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('budget set + check round trip, exit code 2 when over', () => {
  const home = tmpHome();
  try {
    const set = runCli(['budget', 'set', '0.005'], home);
    assert.equal(set.status, 0, set.stderr);
    assert.ok(existsSync(path.join(home, '.agentstats', 'config.json')));

    const check = runCli(['budget', '--month', currentMonth(), '--json'], home);
    const status = JSON.parse(check.stdout);
    assert.ok(Math.abs(status.spend - EXPECTED_TOTAL) < 1e-9);
    assert.equal(status.level, 'over');
    assert.equal(check.status, 2);

    const clear = runCli(['budget', 'clear'], home);
    assert.equal(clear.status, 0);
    const after = JSON.parse(runCli(['budget', '--month', currentMonth(), '--json'], home).stdout);
    assert.equal(after, null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('daily exits 2 when over budget (human output)', () => {
  const home = tmpHome();
  try {
    // keep the fixture pricing pins so the spend stays deterministic across
    // bundled-table refreshes; only the budget itself is added
    const cfgPath = path.join(home, '.agentstats', 'config.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    cfg.budget = 0.005;
    writeFileSync(cfgPath, JSON.stringify(cfg), 'utf8');
    const r = runCli(['daily'], home);
    assert.equal(r.status, 2);
    assert.ok(r.stdout.includes('Budget'));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('projects --json ranks projects by cost', () => {
  const r = runCli(['projects', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const rows = JSON.parse(r.stdout);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].project, 'C--code-web');
  assert.equal(rows[0].sessions, 3);
  assert.ok(rows[0].costUsd >= rows[rows.length - 1].costUsd);
  const human = runCli(['projects']);
  assert.equal(human.status, 0, human.stderr);
  assert.ok(human.stdout.includes('Project'));
});

test('unknown command exits 1 with a hint', () => {
  const r = runCli(['nonsense']);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes('unknown command'));
});

test('--agent filter restricts sources', () => {
  const r = runCli(['agents', '--json', '--agent', 'codex,gemini']);
  const rows = JSON.parse(r.stdout);
  assert.deepEqual(rows.map((row) => row.agent).sort(), ['codex', 'gemini']);
});
