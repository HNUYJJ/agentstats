import { createInterface } from 'node:readline';
import { createReadStream, existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import * as path from 'node:path';

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
