import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const distCli = path.join(root, 'dist', 'cli.js');
export const fixturesHome = path.join(root, 'test', 'fixtures', 'home');

export function runCli(args, home = fixturesHome, extraEnv = {}) {
  return spawnSync(process.execPath, [distCli, ...args], {
    env: { ...process.env, AGENTSTATS_HOME: home, NO_COLOR: '1', ...extraEnv },
    encoding: 'utf8',
  });
}

/** The current calendar month as YYYY-MM. */
export function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Copy fixtures into a temp home with every event date moved into the current
 * calendar month, so month-scoped assertions (budget warnings etc.) hold
 * regardless of when the suite runs. Fixtures use 2026-08-… dates throughout.
 */
export function tmpHome() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agentstats-test-'));
  cpSync(fixturesHome, dir, { recursive: true });
  const month = currentMonth();
  const rewrite = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) rewrite(p);
      else if (/\.(json|jsonl)$/.test(entry.name)) {
        writeFileSync(p, readFileSync(p, 'utf8').split('2026-08-').join(month + '-'));
      }
    }
  };
  rewrite(dir);
  return dir;
}
