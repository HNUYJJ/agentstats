import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

/**
 * Registers the agentstats MCP server into supported coding harnesses.
 * Every write keeps a `<file>.agentstats-backup` next to the original, and
 * unparseable foreign configs are refused rather than overwritten.
 */

export interface McpLaunch {
  command: string;
  args: string[];
  /** human explanation of how this launch was chosen (shown after install) */
  note: string;
}

/**
 * Decide how a harness should spawn the agentstats MCP server.
 *
 * - The global `agentstats` binary is preferred (survives npm updates, short
 *   config lines). On Windows the binary is an `agentstats.cmd` shim that
 *   cannot be spawned directly by harnesses using CreateProcess, so it goes
 *   through `cmd /c`.
 * - When the binary is not on PATH (repo checkout, `npx` without -g), fall
 *   back to the exact running script via `node <dist/cli.js>` so that
 *   `npx agentstats install codex` produces a working registration anyway.
 */
export function mcpLaunchFor(
  isWin32: boolean,
  globalBinOnPath: boolean,
  cliPath: string,
  nodePath: string
): McpLaunch {
  if (globalBinOnPath) {
    return isWin32
      ? { command: 'cmd', args: ['/c', 'agentstats', 'mcp'], note: 'via the global agentstats command (cmd /c shim for Windows)' }
      : { command: 'agentstats', args: ['mcp'], note: 'via the global agentstats command' };
  }
  return {
    command: nodePath,
    args: [cliPath, 'mcp'],
    note: 'absolute node fallback because "agentstats" was not found on PATH (npm i -g agentstats makes this portable)',
  };
}

/** True when a global `agentstats` binary shim exists on PATH. */
export function globalBinOnPath(isWin32: boolean = process.platform === 'win32'): boolean {
  const names = isWin32 ? ['agentstats.cmd', 'agentstats.exe', 'agentstats'] : ['agentstats'];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      if (existsSync(path.join(dir, name))) return true;
    }
  }
  return false;
}

/** Path of the bundled cli.js that ships next to this module in dist/. */
export function bundledCliPath(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'cli.js');
}

export function resolveLaunch(): McpLaunch {
  const isWin32 = process.platform === 'win32';
  return mcpLaunchFor(isWin32, globalBinOnPath(isWin32), bundledCliPath(), process.execPath);
}

function tomlLaunchBlock(launch: McpLaunch): string {
  const args = launch.args.map((a) => JSON.stringify(a)).join(', ');
  return `\n[mcp_servers.agentstats]\ncommand = ${JSON.stringify(launch.command)}\nargs = [${args}]\n`;
}

function jsonLaunchEntry(launch: McpLaunch): { command: string; args: string[] } {
  return { command: launch.command, args: [...launch.args] };
}

export interface InstallResult {
  result: 'installed' | 'already';
  backup?: string;
  file: string;
  launch: McpLaunch;
}

export interface HarnessSpec {
  id: string;
  label: string;
  file: (home: string) => string;
  install: (file: string) => InstallResult;
  isConfigured: (file: string) => boolean;
}

function jsonUpsert(file: string): InstallResult {
  const launch = resolveLaunch();
  let doc: Record<string, unknown> = {};
  let backup: string | undefined;
  if (existsSync(file)) {
    const raw = readFileSync(file, 'utf8');
    try {
      doc = JSON.parse(raw);
    } catch {
      throw new Error(`${file} is not valid JSON - refusing to edit it; add the mcpServers entry by hand`);
    }
    const servers = (doc as Record<string, any>).mcpServers;
    if (servers && typeof servers === 'object' && !Array.isArray(servers) && servers.agentstats) {
      return { result: 'already', file, launch };
    }
    backup = file + '.agentstats-backup';
    copyFileSync(file, backup);
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) doc = {};
  const servers = (doc as Record<string, any>).mcpServers;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
    (doc as Record<string, any>).mcpServers = {};
  }
  (doc as Record<string, any>).mcpServers.agentstats = jsonLaunchEntry(launch);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  return { result: 'installed', backup, file, launch };
}

/** `[mcp_servers.agentstats]`, `[mcp_servers."agentstats"]`, `[ 'mcp_servers'.'agentstats' ]` ... */
const TOML_AGENTSTATS_SECTION = /^\s*\[mcp_servers\.["']?agentstats["']?\]\s*$/m;

function tomlUpsert(file: string): InstallResult {
  const launch = resolveLaunch();
  let raw = '';
  let backup: string | undefined;
  if (existsSync(file)) {
    raw = readFileSync(file, 'utf8');
    if (TOML_AGENTSTATS_SECTION.test(raw)) {
      return { result: 'already', file, launch };
    }
    backup = file + '.agentstats-backup';
    copyFileSync(file, backup);
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, raw.replace(/\n*$/, '\n') + tomlLaunchBlock(launch), 'utf8');
  return { result: 'installed', backup, file, launch };
}

function jsonConfigured(file: string): boolean {
  try {
    const doc = JSON.parse(readFileSync(file, 'utf8')) as Record<string, any>;
    const servers = doc.mcpServers;
    return !!(servers && typeof servers === 'object' && !Array.isArray(servers) && servers.agentstats);
  } catch {
    return false;
  }
}

function tomlConfigured(file: string): boolean {
  try {
    return TOML_AGENTSTATS_SECTION.test(readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
}

export const HARNESS_TARGETS: HarnessSpec[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    file: (home) => path.join(home, '.claude.json'),
    install: jsonUpsert,
    isConfigured: jsonConfigured,
  },
  {
    id: 'codex',
    label: 'Codex CLI / desktop',
    file: (home) => path.join(home, '.codex', 'config.toml'),
    install: tomlUpsert,
    isConfigured: tomlConfigured,
  },
  {
    id: 'cursor',
    label: 'Cursor',
    file: (home) => path.join(home, '.cursor', 'mcp.json'),
    install: jsonUpsert,
    isConfigured: jsonConfigured,
  },
  {
    id: 'gemini',
    label: 'Gemini CLI / Antigravity CLI',
    file: (home) => path.join(home, '.gemini', 'settings.json'),
    install: jsonUpsert,
    isConfigured: jsonConfigured,
  },
];

export function findHarness(id: string): HarnessSpec | undefined {
  return HARNESS_TARGETS.find((t) => t.id === id);
}

export interface HarnessStatus {
  spec: HarnessSpec;
  file: string;
  detected: boolean;
  configured: boolean;
}

export function harnessStatuses(home: string): HarnessStatus[] {
  return HARNESS_TARGETS.map((spec) => {
    const file = spec.file(home);
    return { spec, file, detected: existsSync(file), configured: spec.isConfigured(file) };
  });
}
