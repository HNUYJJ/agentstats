import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { AgentId, ParsedFile, RateLimitSnapshot, RateWindow, UsageEvent } from '../types.js';
import { PersistentCache } from '../cache.js';
import { baseName, cachedFileEvents, linesOf, listFiles, looksLikeModel, mtimeMs, safeInt } from './util.js';

/**
 * Codex CLI (and the Codex desktop app) write rollout files under
 * `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (+ `archived_sessions/`).
 *
 * Two sources of per-response usage exist, and newer builds write both for
 * the same responses:
 *  - `token_usage_record` (preferred): one line per API response with a
 *    unique `response_id` and the exact `usage` object - no deltas needed.
 *  - `event_msg`/`token_count`: cumulative `total_token_usage` plus
 *    `last_token_usage`. The same `last_token_usage` can be re-broadcast on
 *    subsequent token_count lines (e.g. at turn end), so identical
 *    consecutive payloads must not be counted twice.
 *
 * When a file contains token_usage_record lines, they are authoritative and
 * token_count lines are ignored, which both avoids double counting and
 * drops the turn-end re-broadcasts. Files without any records fall back to
 * the token_count deltas.
 *
 * `cached_input_tokens` is a subset of `input_tokens`, so full-price input
 * = input - cached; `cache_write_input_tokens` stays inside the full-price
 * input because OpenAI bills cache writes at the plain input rate.
 * The active model is only recorded on metadata lines (session_meta /
 * turn_context / collaboration_mode...), so we track the most recent model
 * seen while streaming the file. One session can legitimately switch models
 * mid-flight (e.g. gpt-5.6-luna + gpt-5.6-sol).
 */

/** Lines that can affect usage or model attribution; everything else in a
 * rollout is conversation payload that would only waste parse time. */
const RELEVANT = ['"token_count"', '"token_usage_record"', '"session_meta"', '"turn_context"', '"collaboration_mode"'];

export const codexAdapter = {
  id: 'codex' as AgentId,
  roots: (home: string) => [
    path.join(home, '.codex', 'sessions'),
    path.join(home, '.codex', 'archived_sessions'),
  ],

  async scan(home: string, cache?: PersistentCache) {
    const roots = this.roots(home);
    const root = roots[0];
    const events: UsageEvent[] = [];
    const notes: string[] = [];
    let limits: RateLimitSnapshot | undefined;
    let files = 0;

    for (const dir of roots) {
      const batch = await listFiles(dir, (n) => n.endsWith('.jsonl'));
      files += batch.length;
      for (const file of batch) {
        const parsed = await cachedFileEvents(file, () => parseCodexFile(file), cache);
        events.push(...parsed.events);
        // rate limits are cumulative snapshots; the newest one wins. Files are
        // visited in sorted order (name encodes the date), but timestamps are
        // the authority - a long-running old session can outlive a newer file.
        const snapshot = parsed.limits?.[0];
        if (snapshot && (!limits || snapshot.ts > limits.ts)) limits = snapshot;
      }
    }
    return {
      agent: this.id as AgentId,
      root,
      exists: files > 0 || existsSync(root),
      files,
      events,
      notes,
      ...(limits ? { limits: [limits] } : {}),
    };
  },
};

interface TokenUsage {
  input_tokens?: unknown;
  cached_input_tokens?: unknown;
  output_tokens?: unknown;
}

function asWindow(v: unknown): RateWindow | null {
  if (!v || typeof v !== 'object') return null;
  const w = v as Record<string, unknown>;
  const used = Number(w['used_percent']);
  const minutes = Number(w['window_minutes']);
  const resets = Number(w['resets_at']);
  if (!Number.isFinite(used) || !Number.isFinite(minutes) || !Number.isFinite(resets)) return null;
  return { usedPercent: used, windowMinutes: minutes, resetsAt: resets };
}

/** Extract the rate-limit snapshot carried by a token_count payload, if any. */
function rateLimitsOf(payload: any, ts: number): RateLimitSnapshot | undefined {
  const rl = payload?.rate_limits;
  if (!rl || typeof rl !== 'object') return undefined;
  const primary = asWindow(rl.primary);
  const secondary = asWindow(rl.secondary);
  if (!primary && !secondary) return undefined;
  return {
    agent: 'codex',
    ts,
    ...(typeof rl.limit_id === 'string' && rl.limit_id ? { limitId: rl.limit_id } : {}),
    ...(typeof rl.plan_type === 'string' && rl.plan_type ? { planType: rl.plan_type } : {}),
    primary,
    secondary,
  };
}

async function parseCodexFile(file: string): Promise<ParsedFile> {
  const fallbackTs = await mtimeMs(file);
  let sessionId = fileBasenameSessionId(file);
  let cwd: string | null = null;
  let model: string | null = null;

  const events: UsageEvent[] = [];
  const records: UsageEvent[] = []; // from token_usage_record lines
  const counts: UsageEvent[] = []; // from token_count delta lines
  const recordIds = new Set<string>();
  let lastCountKey: string | null = null; // consecutive duplicate last_token_usage guard
  let prev: { input: number; cached: number; output: number } | null = null;
  let limits: RateLimitSnapshot | undefined;

  const push = (into: UsageEvent[], usage: TokenUsage, ts: number, sessionOverride?: string): void => {
    const cached = safeInt(usage.cached_input_tokens);
    const input = Math.max(0, safeInt(usage.input_tokens) - cached);
    const output = safeInt(usage.output_tokens);
    if (!input && !cached && !output) return;
    into.push({
      agent: 'codex',
      sessionId: sessionOverride ?? sessionId,
      project: cwd ? baseName(cwd) : 'codex',
      model: model || 'unknown',
      ts,
      input,
      cacheRead: cached,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
      output,
    });
  };

  for await (const line of linesOf(file)) {
    if (!RELEVANT.some((s) => line.includes(s))) continue;
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
    } else if (payload.type === 'token_usage_record' || lineType === 'token_usage_record') {
      const usage = payload.usage;
      if (!usage || typeof usage.input_tokens !== 'number') continue;
      const rid = typeof payload.response_id === 'string' && payload.response_id ? payload.response_id : '';
      const key = rid || JSON.stringify([usage.input_tokens, usage.cached_input_tokens, usage.output_tokens]);
      if (recordIds.has(key)) continue;
      recordIds.add(key);
      const session = typeof payload.session_id === 'string' && payload.session_id ? payload.session_id : undefined;
      push(records, usage, ts, session);
    } else if (payload.type === 'token_count') {
      const info = payload.info ?? payload;
      const total = info?.total_token_usage;
      const last = info?.last_token_usage;
      const snapshot = rateLimitsOf(payload, ts);
      if (snapshot && (!limits || snapshot.ts > limits.ts)) limits = snapshot;
      let d: TokenUsage | null = null;
      if (last && typeof last.input_tokens === 'number') {
        const key = JSON.stringify([last.input_tokens, last.cached_input_tokens, last.output_tokens]);
        if (key !== lastCountKey) {
          d = last;
          lastCountKey = key;
        }
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
      if (d) push(counts, d, ts);
    }
  }

  // token_usage_record is the authoritative per-response source; token_count
  // is only used for older files that never emit records
  return { events: records.length ? records : counts, ...(limits ? { limits: [limits] } : {}) };
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
