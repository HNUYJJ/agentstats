import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { AgentId, UsageEvent } from '../types.js';
import { baseName, cachedFileEvents, linesOf, listFiles, mtimeMs, safeInt } from './util.js';

/**
 * Claude Code stores one JSONL transcript per session under
 * `~/.claude/projects/<project-slug>/<session-id>.jsonl`.
 *
 * Assistant entries carry `message.usage` with input / output tokens and the
 * cache breakdown. Cache writes appear either as a flat
 * `cache_creation_input_tokens` (5m TTL) or as a structured
 * `cache_creation: { ephemeral_5m_input_tokens, ephemeral_1h_input_tokens }`.
 * Retries/streaming can duplicate a message within a file, so entries are
 * deduped on (message.id, requestId, output_tokens) per file.
 */
export const claudeAdapter = {
  id: 'claude' as AgentId,
  rootOf: (home: string) => path.join(home, '.claude', 'projects'),

  async scan(home: string) {
    const root = this.rootOf(home);
    const files = await listFiles(root, (n) => n.endsWith('.jsonl'));
    const events: UsageEvent[] = [];
    const notes: string[] = [];

    for (const file of files) {
      const project = path.relative(root, file).split(path.sep)[0] || 'unknown';
      const parsed = await cachedFileEvents(file, () => parseClaudeFile(file, project));
      events.push(...parsed);
    }
    return { agent: this.id as AgentId, root, exists: files.length > 0 || existsSync(root), files: files.length, events, notes };
  },
};

async function parseClaudeFile(file: string, project: string): Promise<UsageEvent[]> {
  const events: UsageEvent[] = [];
  const seen = new Set<string>();
  const fallbackTs = await mtimeMs(file);

  for await (const line of linesOf(file)) {
    if (!line.includes('"usage"')) continue;
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (!obj || obj.type !== 'assistant' || !obj.message) continue;
    const usage = obj.message.usage;
    const model = obj.message.model;
    if (!usage || typeof model !== 'string' || !model) continue;
    // placeholder entries produced for local tool results, not API calls
    if (model.startsWith('synthetic') || /^<.+>$/.test(model)) continue;

    const output = safeInt(usage.output_tokens);
    const key = `${obj.message.id}|${obj.requestId ?? ''}|${output}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const cacheObj = usage.cache_creation;
    const cacheWrite1h = cacheObj ? safeInt(cacheObj.ephemeral_1h_input_tokens) : 0;
    const cacheWrite5m = cacheObj
      ? safeInt(cacheObj.ephemeral_5m_input_tokens)
      : safeInt(usage.cache_creation_input_tokens);

    events.push({
      agent: 'claude',
      sessionId: typeof obj.sessionId === 'string' && obj.sessionId ? obj.sessionId : baseName(file).replace(/\.jsonl$/, ''),
      project,
      model,
      ts: Date.parse(obj.timestamp) || fallbackTs,
      input: safeInt(usage.input_tokens),
      cacheRead: safeInt(usage.cache_read_input_tokens),
      cacheWrite5m,
      cacheWrite1h,
      output,
    });
  }
  return events;
}
