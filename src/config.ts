import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Config } from './types.js';

/**
 * Root directory that holds `~/.claude`, `~/.codex`, `~/.gemini` and the
 * `.agentstats` config folder. Overridable via AGENTSTATS_HOME (used by tests).
 */
export function homeDir(): string {
  return process.env.AGENTSTATS_HOME || os.homedir();
}

export function configDir(home: string = homeDir()): string {
  return path.join(home, '.agentstats');
}

export function configPath(home: string = homeDir()): string {
  return path.join(configDir(home), 'config.json');
}

export function loadConfig(home: string = homeDir()): Config {
  const p = configPath(home);
  if (!existsSync(p)) return {};
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as Config;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

export function saveConfig(cfg: Config, home: string = homeDir()): void {
  const dir = configDir(home);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}
