import { createInterface } from 'node:readline';
import { createReadStream, existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { UsageEvent } from '../types.js';

/**
 * mtime+size keyed per-file cache, so watch mode and repeated MCP tool calls
 * skip re-parsing logs that have not changed since the last scan in this
 * process. Parse failures are never cached.
 */
const fileCache = new Map<string, { key: string; events: UsageEvent[] }>();

const MAX_CACHED_FILE_BYTES = 64 * 1024 * 1024;

export async function cachedFileEvents(file: string, parse: () => Promise<UsageEvent[]>): Promise<UsageEvent[]> {
  let statOk = false;
  try {
    const st = await stat(file);
    statOk = true;
    const key = `${Math.round(st.mtimeMs)}:${st.size}`;
    const hit = fileCache.get(file);
    if (hit && hit.key === key) return hit.events;
    const events = await parse();
    if (st.size <= MAX_CACHED_FILE_BYTES) fileCache.set(file, { key, events });
    return events;
  } catch (err) {
    if (statOk) throw err; // parse error: propagate, cache untouched
    return parse(); // stat itself failed (file vanished mid-scan): let parse report it
  }
}

/** Recursively collect files under `root` whose names pass `filter`. */
export async function listFiles(root: string, filter?: (name: string) => boolean): Promise<string[]> {
  const out: string[] = [];
  if (!existsSync(root)) return out;
  await walk(root, out, filter);
  out.sort();
  return out;
}

async function walk(dir: string, out: string[], filter?: (name: string) => boolean): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      await walk(p, out, filter);
    } else if (ent.isFile()) {
      if (!filter || filter(ent.name)) out.push(p);
    }
  }
}

/** Stream a file line by line without loading it fully into memory. */
export async function* linesOf(file: string): AsyncGenerator<string> {
  const rl = createInterface({
    input: createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  try {
    for await (const line of rl) yield line;
  } finally {
    rl.close();
  }
}

export async function mtimeMs(file: string): Promise<number> {
  try {
    return (await stat(file)).mtimeMs;
  } catch {
    return 0;
  }
}

/** Basename that understands both POSIX and Windows separators. */
export function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

export function safeInt(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

/** Heuristic for strings that look like model names. */
export function looksLikeModel(s: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{2,63}$/i.test(s) && /[a-z]/i.test(s);
}
