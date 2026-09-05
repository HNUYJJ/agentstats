import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { AgentId, UsageEvent } from '../types.js';
import { baseName, cachedFileEvents, linesOf, listFiles, mtimeMs, safeInt } from './util.js';

/**
 * Gemini CLI stores sessions under `~/.gemini/tmp/<project-hash>/chats/`.
 * Newer versions write one JSON file per session
 * (`{ sessionId, projectHash, startTime, lastUpdated, messages: [...] }`);
 * some versions write JSONL instead. Token usage, when recorded at all,
 * lives in `usageMetadata` objects inside model messages:
 * { promptTokenCount, candidatesTokenCount, thoughtsTokenCount,
 *   cachedContentTokenCount }.
 *
 * This adapter is deliberately tolerant: it scans both shapes and deep-searches
 * for `usageMetadata`, attributing the nearest enclosing `model` string.
 * Thinking tokens are billed as output by Google. Legacy Gemini CLI versions
 * and Antigravity record no per-turn usage at all — `doctor` reports that
 * explicitly instead of showing a silent $0.
 */
export const geminiAdapter = {
  id: 'gemini' as AgentId,
  rootOf: (home: string) => path.join(home, '.gemini', 'tmp'),

  async scan(home: string) {
    const root = this.rootOf(home);
    const files = await listFiles(
      root,
      (n) => (n.startsWith('session-') && n.endsWith('.json')) || n.endsWith('.jsonl')
    );
    const events: UsageEvent[] = [];
    const notes: string[] = [];

    for (const file of files) {
      const parsed = await cachedFileEvents(file, () => parseGeminiFile(file, root));
      events.push(...parsed);
    }

    if (files.length > 0 && events.length === 0) {
      notes.push('legacy Gemini CLI sessions found but they contain no token usage data');
    }
    const antigravityDir = path.join(home, '.gemini', 'antigravity');
    if (existsSync(antigravityDir)) {
      notes.push(
        `Antigravity data detected at ${antigravityDir} - Google does not record per-turn token usage in local Antigravity logs, so nothing can be parsed from it`
      );
    }
    return { agent: this.id as AgentId, root, exists: files.length > 0, files: files.length, events, notes };
  },
};

async function parseGeminiFile(file: string, root: string): Promise<UsageEvent[]> {
  const hashDir = path.relative(root, file).split(path.sep)[0] || 'unknown';
  const projectRootFile = path.join(root, hashDir, '.project_root');
  let project = `gemini:${hashDir.slice(0, 8)}`;
  try {
    const pr = readFileSync(projectRootFile, 'utf8').trim().split(/\r?\n/)[0];
    if (pr) project = baseName(pr);
  } catch {
    /* keep hash label */
  }
  const fallbackTs = await mtimeMs(file);
  const isJsonl = file.endsWith('.jsonl');
  const defaultSessionId = baseName(file).replace(/\.(json|jsonl)$/, '');

  const units: Array<{ node: any; ts: number }> = [];
  if (isJsonl) {
    for await (const line of linesOf(file)) {
      try {
        units.push({ node: JSON.parse(line), ts: 0 });
      } catch {
        /* skip bad line */
      }
    }
  } else {
    let doc: any;
    try {
      doc = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return [];
    }
    const fileTs = Date.parse(doc?.lastUpdated) || Date.parse(doc?.startTime) || fallbackTs;
    const messages = Array.isArray(doc?.messages) ? doc.messages : [doc];
    for (const msg of messages) {
      units.push({ node: msg, ts: Date.parse(msg?.timestamp) || fileTs });
    }
  }

  const events: UsageEvent[] = [];
  const state = { model: null as string | null };
  for (const { node, ts } of units) {
    const found: Array<{ um: any; model: string | null }> = [];
    collect(node, 0, state, found);
    for (const { um, model } of found) {
      const prompt = safeInt(um.promptTokenCount);
      const cached = safeInt(um.cachedContentTokenCount);
      const output = safeInt(um.candidatesTokenCount) + safeInt(um.thoughtsTokenCount);
      if (!prompt && !output) continue;
      events.push({
        agent: 'gemini',
        sessionId: String(node?.sessionId ?? defaultSessionId),
        project,
        model: model || 'unknown',
        ts,
        input: Math.max(0, prompt - cached),
        cacheRead: cached,
        cacheWrite5m: 0,
        cacheWrite1h: 0,
        output,
      });
    }
  }
  return events;
}

/** Deep-search a message subtree for usageMetadata objects, tracking model context. */
function collect(node: unknown, depth: number, state: { model: string | null }, out: Array<{ um: any; model: string | null }>): void {
  if (!node || typeof node !== 'object' || depth > 12) return;
  if (Array.isArray(node)) {
    for (const item of node) collect(item, depth + 1, state, out);
    return;
  }
  const obj = node as Record<string, unknown>;
  const m = obj['model'];
  if (typeof m === 'string' && /^[a-z0-9][a-z0-9._-]{2,63}$/i.test(m) && /[a-z]/i.test(m)) {
    state.model = m;
  }
  const um = obj['usageMetadata'];
  if (um && typeof um === 'object') {
    out.push({ um, model: state.model });
    return; // usageMetadata has no nested usage
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'usageMetadata') continue;
    collect(v, depth + 1, state, out);
  }
}
