import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { AgentId, UsageEvent } from '../types.js';
import { baseName, cachedFileEvents, linesOf, listFiles, looksLikeModel, mtimeMs, safeInt } from './util.js';

/**
 * Codex CLI (and the Codex desktop app) write rollout files under
 * `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (+ `archived_sessions/`).
 *
 * Token usage arrives as cumulative `total_token_usage` plus per-call
 * `last_token_usage` deltas inside `event_msg`/`token_count` payloads.
 * `cached_input_tokens` is a subset of `input_tokens`, so full-price input
 * = input - cached. The active model is only recorded on metadata lines
 * (session_meta / turn_context / collaboration_mode...), so we track the
 * most recent model seen while streaming the file. One session can
 * legitimately switch models mid-flight (e.g. gpt-5.6-luna + gpt-5.6-sol).
 */
export const codexAdapter = {
  id: 'codex' as AgentId,
  roots: (home: string) => [
    path.join(home, '.codex', 'sessions'),
    path.join(home, '.codex', 'archived_sessions'),
  ],

  async scan(home: string) {
    const roots = this.roots(home);
    const root = roots[0];
    const events: UsageEvent[] = [];
    const notes: string[] = [];
    let files = 0;

    for (const dir of roots) {
      const batch = await listFiles(dir, (n) => n.endsWith('.jsonl'));
      files += batch.length;
      for (const file of batch) {
        const parsed = await cachedFileEvents(file, () => parseCodexFile(file));
        events.push(...parsed);
      }
    }
    return { agent: this.id as AgentId, root, exists: files > 0 || existsSync(root), files, events, notes };
  },
};

async function parseCodexFile(file: string): Promise<UsageEvent[]> {
  const events: UsageEvent[] = [];
  const fallbackTs = await mtimeMs(file);
  let sessionId = fileBasenameSessionId(file);
  let cwd: string | null = null;
  let model: string | null = null;
  let prev: { input: number; cached: number; output: number } | null = null;

  for await (const line of linesOf(file)) {
    if (!line.includes('"payload"')) continue;
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = obj?.payload;
    if (!payload || typeof payload !== 'object') continue;
    const ts = Date.parse(obj.timestamp) || fallbackTs;
    // session_meta/turn_context are line-level types; token_count is payload-level
    const lineType = typeof obj.type === 'string' ? obj.type : '';
    const isMeta = payload.type === 'session_meta' || lineType === 'session_meta';
    const isTurn = payload.type === 'turn_context' || lineType === 'turn_context';

    if (typeof payload.model === 'string' && looksLikeModel(payload.model)) {
      model = payload.model;
    } else if (isMeta || isTurn) {
      const deep = findModelDeep(payload, 0);
      if (deep) model = deep;
    }
    if (isMeta) {
      sessionId = payload.id || payload.session_id || sessionId;
      if (typeof payload.cwd === 'string') cwd = payload.cwd;
    } else if (isTurn && typeof payload.cwd === 'string') {
      cwd = payload.cwd;
    } else if (payload.type === 'token_count') {
      const info = payload.info ?? payload;
      const total = info?.total_token_usage;
      const last = info?.last_token_usage;
      let d: any = null;
      if (last && typeof last.input_tokens === 'number') {
        d = last;
        if (total && typeof total.input_tokens === 'number') {
          prev = {
            input: safeInt(total.input_tokens),
            cached: safeInt(total.cached_input_tokens),
            output: safeInt(total.output_tokens),
          };
        }
      } else if (total && typeof total.input_tokens === 'number') {
        const cur = {
          input: safeInt(total.input_tokens),
          cached: safeInt(total.cached_input_tokens),
          output: safeInt(total.output_tokens),
        };
        if (prev) {
          d = {
            input_tokens: Math.max(0, cur.input - prev.input),
            cached_input_tokens: Math.max(0, cur.cached - prev.cached),
            output_tokens: Math.max(0, cur.output - prev.output),
          };
        } else {
          d = { input_tokens: cur.input, cached_input_tokens: cur.cached, output_tokens: cur.output };
        }
        prev = cur;
      }
      if (!d) continue;
      const cached = safeInt(d.cached_input_tokens);
      const input = Math.max(0, safeInt(d.input_tokens) - cached);
      const output = safeInt(d.output_tokens);
      if (!input && !cached && !output) continue;
      events.push({
        agent: 'codex',
        sessionId,
        project: cwd ? baseName(cwd) : 'codex',
        model: model || 'unknown',
        ts,
        input,
        cacheRead: cached,
        cacheWrite5m: 0,
        cacheWrite1h: 0,
        output,
      });
    }
  }
  return events;
}

/** rollout-2026-08-28T14-08-27-<uuid>.jsonl -> the trailing uuid */
function fileBasenameSessionId(file: string): string {
  const base = baseName(file).replace(/\.jsonl$/, '');
  const parts = base.split('-');
  return parts.length >= 5 ? parts.slice(-5).join('-') : base;
}

/** Find the first model-like `model` string in a metadata payload (bounded depth). */
function findModelDeep(node: unknown, depth: number): string | null {
  let found: string | null = null;
  const visit = (v: unknown, d: number) => {
    if (found || !v || typeof v !== 'object' || d > 6) return;
    if (Array.isArray(v)) {
      for (const item of v) visit(item, d + 1);
      return;
    }
    const o = v as Record<string, unknown>;
    const m = o['model'];
    if (typeof m === 'string' && looksLikeModel(m)) {
      found = m;
      return;
    }
    for (const k of Object.keys(o)) visit(o[k], d + 1);
  };
  visit(node, depth);
  return found;
}
