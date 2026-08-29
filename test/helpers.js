import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const distCli = path.join(root, 'dist', 'cli.js');
export const fixturesHome = path.join(root, 'test', 'fixtures', 'home');

export function runCli(args, home = fixturesHome, extraEnv = {}) {
  return spawnSync(process.execPath, [distCli, ...args], {
    env: { ...process.env, AGENTSTATS_HOME: home, NO_COLOR: '1', ...extraEnv },
    encoding: 'utf8',
  });
}
