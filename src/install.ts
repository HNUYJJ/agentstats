import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

/**
 * Registers the agentstats MCP server into supported coding harnesses.
 * Every write keeps a `<file>.agentstats-backup` next to the original, and
 * unparseable foreign configs are refused rather than overwritten.
 */

const MCP_ENTRY = { command: 'agentstats', args: ['mcp'] };

export interface InstallResult {
  result: 'installed' | 'already';
  backup?: string;
  file: string;
}

export interface HarnessSpec {
  id: string;
  label: string;
  file: (home: string) => string;
  install: (file: string) => InstallResult;
  isConfigured: (file: string) => boolean;
}

function jsonUpsert(file: string): InstallResult {
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
      return { result: 'already', file };
    }
    backup = file + '.agentstats-backup';
    copyFileSync(file, backup);
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) doc = {};
  const servers = (doc as Record<string, any>).mcpServers;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
    (doc as Record<string, any>).mcpServers = {};
  }
  (doc as Record<string, any>).mcpServers.agentstats = { ...MCP_ENTRY };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  return { result: 'installed', backup, file };
}

function tomlUpsert(file: string): InstallResult {
  let raw = '';
  let backup: string | undefined;
  if (existsSync(file)) {
    raw = readFileSync(file, 'utf8');
    if (/^\s*\[mcp_servers\.agentstats\]\s*$/m.test(raw)) {
      return { result: 'already', file };
    }
    backup = file + '.agentstats-backup';
    copyFileSync(file, backup);
  }
  const block = '\n[mcp_servers.agentstats]\ncommand = "agentstats"\nargs = ["mcp"]\n';
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, raw.replace(/\n*$/, '\n') + block, 'utf8');
  return { result: 'installed', backup, file };
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
    return /^\s*\[mcp_servers\.agentstats\]\s*$/m.test(readFileSync(file, 'utf8'));
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
