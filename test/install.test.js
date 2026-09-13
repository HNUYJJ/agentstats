import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { distCli, runCli, tmpHome } from './helpers.js';
import { mcpLaunchFor } from '../dist/install.js';

const NODE = process.execPath;
const CLI = distCli;

test('mcpLaunchFor prefers the global binary, via cmd /c on Windows', () => {
  const posix = mcpLaunchFor(false, true, CLI, NODE);
  assert.deepEqual([posix.command, posix.args], ['agentstats', ['mcp']]);

  const win32 = mcpLaunchFor(true, true, CLI, NODE);
  assert.deepEqual([win32.command, win32.args], ['cmd', ['/c', 'agentstats', 'mcp']]);
});

test('mcpLaunchFor falls back to node + absolute script when not on PATH', () => {
  const launch = mcpLaunchFor(true, false, CLI, NODE);
  assert.equal(launch.command, NODE);
  assert.deepEqual(launch.args, [CLI, 'mcp']);
  assert.ok(launch.note.includes('not found on PATH'));
});

test('install codex is idempotent across TOML table-key spellings', () => {
  const home = tmpHome();
  try {
    const cfg = path.join(home, '.codex', 'config.toml');
    mkdirSync(path.dirname(cfg), { recursive: true });
    // some users (or other tools) quote the table key; that is valid TOML for
    // the same table and must be detected instead of duplicated
    writeFileSync(cfg, 'model = "gpt-6-astra"\n[mcp_servers."agentstats"]\ncommand = "agentstats"\nargs = ["mcp"]\n');

    const r = runCli(['install', 'codex', '--no-verify'], home);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes('already'), r.stdout);
    assert.equal((readFileSync(cfg, 'utf8').match(/\[mcp_servers/g) ?? []).length, 1, 'no duplicate section written');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('install codex verifies the registered command end-to-end', () => {
  const home = tmpHome();
  try {
    const r = runCli(['install', 'codex'], home);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.stdout.includes('spawn check ok'), r.stdout);
    assert.ok(r.stdout.includes('launch:'), r.stdout);

    const toml = readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8');
    assert.ok(toml.includes('[mcp_servers.agentstats]'));
    assert.ok(/command = "(.+)"/.test(toml));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('doctor --deep spawns the exact MCP command and reports the probe', () => {
  const home = tmpHome();
  try {
    const r = runCli(['doctor', '--deep', '--json'], home);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.spawnCheck.ok, true, JSON.stringify(out.spawnCheck));
    assert.ok(out.spawnCheck.tools >= 7);
    assert.equal(out.limits.length, 1);
    assert.equal(out.limits[0].agent, 'codex');
    assert.equal(out.limits[0].primary.usedPercent, 79);
    assert.equal(out.limits[0].secondary.windowMinutes, 10080);
    assert.equal(out.limits[0].planType, 'plus');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
