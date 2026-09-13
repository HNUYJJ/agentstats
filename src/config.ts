import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Config, ModelPrice } from './types.js';

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

/**
 * The config is user-editable, so never trust it: invalid values are dropped
 * instead of flowing into cost math as NaN.
 */
function sanitizeConfig(parsed: unknown): Config {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const src = parsed as Record<string, unknown>;
  const out: Config = {};
  const budget = Number(src['budget']);
  if (Number.isFinite(budget) && budget > 0) out.budget = budget;
  if (src['pricingOverrides'] && typeof src['pricingOverrides'] === 'object' && !Array.isArray(src['pricingOverrides'])) {
    const overrides: Record<string, ModelPrice> = {};
    for (const [key, value] of Object.entries(src['pricingOverrides'] as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const v = value as Record<string, unknown>;
      const input = Number(v['input']);
      const output = Number(v['output']);
      if (!Number.isFinite(input) || input < 0 || !Number.isFinite(output) || output < 0) continue;
      const cachedInput = v['cachedInput'] === undefined ? undefined : Number(v['cachedInput']);
      overrides[key] = {
        input,
        ...(cachedInput !== undefined && Number.isFinite(cachedInput) && cachedInput >= 0 ? { cachedInput } : {}),
        output,
      };
    }
    if (Object.keys(overrides).length > 0) out.pricingOverrides = overrides;
  }
  return out;
}

export function loadConfig(home: string = homeDir()): Config {
  const p = configPath(home);
  if (!existsSync(p)) return {};
  try {
    return sanitizeConfig(JSON.parse(readFileSync(p, 'utf8')));
  } catch {
    return {};
  }
}

export function saveConfig(cfg: Config, home: string = homeDir()): void {
  const p = configPath(home);
  // preserve keys this version does not know about (future/advanced settings);
  // known keys always come from the sanitized cfg, undefined ones (e.g. after
  // "budget clear") are dropped by JSON.stringify
  let raw: Record<string, unknown> = {};
  if (existsSync(p)) {
    try {
      const parsed = JSON.parse(readFileSync(p, 'utf8')) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>;
    } catch {
      /* unparseable config: start fresh rather than failing the write */
    }
  }
  const merged = { ...raw, ...cfg, budget: cfg.budget, pricingOverrides: cfg.pricingOverrides };
  mkdirSync(configDir(home), { recursive: true });
  writeFileSync(p, JSON.stringify(merged, null, 2) + '\n', 'utf8');
}
