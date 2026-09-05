import { createInterface } from 'node:readline';
import { agentRows, dayKey, filterEvents, groupByFieldSortedByCost, modelRows, sessionRows, totalsOf } from './aggregate.js';
import { budgetStatus } from './budget.js';
import { loadConfig, homeDir } from './config.js';
import { fmtCost, fmtInt, renderTable, setColors } from './format.js';
import { listPriceRows, normalizeModel, priceFor } from './pricing.js';
import { scanAll } from './scan.js';
import { AGENT_IDS, AgentId, totalTokens, UsageEvent } from './types.js';
import { VERSION } from './version.js';

/**
 * Minimal Model Context Protocol server over stdio (JSON-RPC 2.0, no
 * dependencies). Lets coding agents query their own spend:
 *
 *   claude mcp add agentstats -- agentstats mcp
 *   # or any MCP client: { "command": "agentstats", "args": ["mcp"] }
 */

interface RpcError extends Error {
  code?: number;
}

function rpcError(code: number, message: string): RpcError {
  const err = new Error(message) as RpcError;
  err.code = code;
  return err;
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const FILTER_PROPS = {
  since: { type: 'string', description: 'only include days >= YYYY-MM-DD (local time)' },
  until: { type: 'string', description: 'only include days <= YYYY-MM-DD' },
  agent: { type: 'string', description: 'comma-separated subset: claude,codex,gemini' },
  project: { type: 'string', description: 'filter by project name substring' },
  model: { type: 'string', description: 'filter by model name substring' },
};

const TOOLS: ToolDef[] = [
  {
    name: 'usage_summary',
    description: 'Total tokens and estimated cost for the local AI coding agents (Claude Code, Codex CLI, Gemini CLI), with a per-agent breakdown and budget status. All data is read locally.',
    inputSchema: { type: 'object', properties: FILTER_PROPS },
  },
  {
    name: 'daily_usage',
    description: 'Day-by-day tokens and estimated cost, optionally broken down by model, agent or project.',
    inputSchema: {
      type: 'object',
      properties: { ...FILTER_PROPS, breakdown: { type: 'string', enum: ['model', 'agent', 'project', 'none'], description: 'second grouping within each day' } },
    },
  },
  {
    name: 'model_breakdown',
    description: 'Token and cost totals per model, most expensive first. Unpriced models are marked.',
    inputSchema: { type: 'object', properties: FILTER_PROPS },
  },
  {
    name: 'top_sessions',
    description: 'Most expensive sessions in the given period.',
    inputSchema: {
      type: 'object',
      properties: { ...FILTER_PROPS, limit: { type: 'number', description: 'max rows (default 10)' } },
    },
  },
  {
    name: 'budget_status',
    description: 'Current calendar-month spend vs the configured monthly USD budget (if one is set).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'price_lookup',
    description: 'Look up the bundled per-million-token price (with provenance) for a model.',
    inputSchema: { type: 'object', properties: { model: { type: 'string', description: 'model name, e.g. claude-opus-4-8' } }, required: ['model'] },
  },
];

async function loadEvents(args: Record<string, unknown>): Promise<UsageEvent[]> {
  const agentArg = typeof args['agent'] === 'string' ? (args['agent'] as string) : undefined;
  let only: AgentId[] | undefined;
  if (agentArg) {
    only = agentArg.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) as AgentId[];
    const bad = only.filter((a) => !AGENT_IDS.includes(a));
    if (bad.length) throw new Error(`unknown agent(s): ${bad.join(', ')} (supported: ${AGENT_IDS.join(', ')})`);
  }
  const { events } = await scanAll(homeDir(), only);
  return filterEvents(events, {
    since: typeof args['since'] === 'string' ? args['since'] : undefined,
    until: typeof args['until'] === 'string' ? args['until'] : undefined,
    project: typeof args['project'] === 'string' ? args['project'] : undefined,
    model: typeof args['model'] === 'string' ? args['model'] : undefined,
  });
}

function totalsLine(events: UsageEvent[]): string {
  const cfg = loadConfig();
  const t = totalsOf(events, cfg);
  const sessions = new Set(events.map((e) => `${e.agent}/${e.sessionId}`)).size;
  return `${fmtInt(events.length)} events - ${fmtInt(sessions)} sessions - ${fmtInt(totalTokens(t))} tokens - ${fmtCost(t.cost)}`;
}

async function toolText(name: string, args: Record<string, unknown>): Promise<string> {
  const cfg = loadConfig();
  switch (name) {
    case 'usage_summary': {
      const events = await loadEvents(args);
      if (!events.length) return 'no usage found for the given filters';
      const rows = agentRows(events, cfg).map((r) => [
        r.agent,
        fmtInt(r.sessions),
        fmtInt(r.totals.events),
        fmtInt(totalTokens(r.totals)),
        fmtCost(r.totals.cost),
      ]);
      return ['Usage by agent', renderTable(['Agent', 'Sessions', 'Events', 'Tokens', 'Cost (USD)'], rows), '', totalsLine(events)].join('\n');
    }
    case 'daily_usage': {
      const events = await loadEvents(args);
      if (!events.length) return 'no usage found for the given filters';
      const breakdown = typeof args['breakdown'] === 'string' && ['model', 'agent', 'project'].includes(args['breakdown'] as string)
        ? (args['breakdown'] as 'model' | 'agent' | 'project')
        : null;
      const byDay = new Map<string, UsageEvent[]>();
      for (const e of events) {
        const k = dayKey(e.ts);
        (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(e);
      }
      const rows: string[][] = [];
      for (const day of [...byDay.keys()].sort()) {
        const evs = byDay.get(day)!;
        const groups = breakdown
          ? groupByFieldSortedByCost(evs, breakdown, cfg)
          : [['', evs] as [string, UsageEvent[]]];
        for (const [label, list] of groups) {
          const t = totalsOf(list, cfg);
          rows.push([day, ...(breakdown ? [label] : []), fmtInt(t.input), fmtInt(t.output), fmtInt(t.cacheRead + t.cacheWrite5m + t.cacheWrite1h), fmtInt(totalTokens(t)), fmtCost(t.cost)]);
        }
      }
      const header = ['Date', ...(breakdown ? [breakdown === 'model' ? 'Model' : breakdown === 'agent' ? 'Agent' : 'Project'] : []), 'Input', 'Output', 'Cache', 'Total', 'Cost (USD)'];
      return renderTable(header, rows);
    }
    case 'model_breakdown': {
      const events = await loadEvents(args);
      if (!events.length) return 'no usage found for the given filters';
      const rows = modelRows(events, cfg).map((r) => [
        r.priced ? r.model : r.model + ' *',
        fmtInt(totalTokens(r.totals)),
        fmtInt(r.totals.output),
        fmtInt(r.totals.cacheRead + r.totals.cacheWrite5m + r.totals.cacheWrite1h),
        fmtCost(r.totals.cost),
      ]);
      return renderTable(['Model', 'Tokens', 'Output', 'Cache', 'Cost (USD)'], rows);
    }
    case 'top_sessions': {
      const events = await loadEvents(args);
      const limit = typeof args['limit'] === 'number' && args['limit'] > 0 ? Math.floor(args['limit']) : 10;
      const rows = sessionRows(events, cfg).slice(0, limit).map((r) => [
        r.session.slice(0, 12),
        r.date,
        r.agent,
        r.project.slice(0, 30),
        r.model,
        fmtInt(totalTokens(r.totals)),
        fmtCost(r.totals.cost),
      ]);
      if (!rows.length) return 'no usage found for the given filters';
      return renderTable(['Session', 'Date', 'Agent', 'Project', 'Model', 'Tokens', 'Cost (USD)'], rows);
    }
    case 'budget_status': {
      const { events } = await scanAll(homeDir());
      const status = budgetStatus(events, cfg);
      if (!status) return 'no budget configured (set one with: agentstats budget set <usd-amount>)';
      return `Month ${status.month}: ${fmtCost(status.spend)} of ${fmtCost(status.budget)} (${status.usedPct.toFixed(0)}% used), projected ${fmtCost(status.projected)} - level: ${status.level}`;
    }
    case 'price_lookup': {
      const model = typeof args['model'] === 'string' ? args['model'] : '';
      if (!model) throw new Error("missing required argument: model");
      const p = priceFor(model, cfg.pricingOverrides);
      const entry = listPriceRows(cfg.pricingOverrides).find((r) => normalizeModel(r.model) === normalizeModel(model));
      const source = entry?.source ?? 'unknown';
      if (!p) return `no bundled price for '${model}' (normalized: ${normalizeModel(model)}) - set pricingOverrides in ~/.agentstats/config.json`;
      return [
        `model:    ${model}`,
        `normalized: ${normalizeModel(model)}`,
        `input:    $${p.input}/MTok`,
        `cached:   $${(p.cachedInput ?? p.input * 0.1).toString()}/MTok`,
        `output:   $${p.output}/MTok`,
        `source:   ${source}`,
      ].join('\n');
    }
    default:
      throw rpcError(-32602, `unknown tool: ${name}`);
  }
}

async function dispatch(method: string, params: any): Promise<Record<string, unknown>> {
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'agentstats', version: VERSION },
      };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: TOOLS };
    case 'tools/call': {
      const name = typeof params?.name === 'string' ? params.name : '';
      if (!name) throw rpcError(-32602, 'missing tool name');
      if (!TOOLS.some((t) => t.name === name)) throw rpcError(-32602, `unknown tool: ${name}`);
      let text: string;
      try {
        text = await toolText(name, (params?.arguments ?? {}) as Record<string, unknown>);
      } catch (err) {
        return { content: [{ type: 'text', text: `error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
      return { content: [{ type: 'text', text }] };
    }
    default:
      throw rpcError(-32601, `method not found: ${method}`);
  }
}

/** Run the stdio MCP server until stdin closes. */
export async function runMcpServer(): Promise<number> {
  setColors(false);
  const send = (msg: unknown): void => {
    process.stdout.write(JSON.stringify(msg) + '\n');
  };
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let req: { id?: number | string | null; method?: string; params?: any };
    try {
      req = JSON.parse(trimmed);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
      continue;
    }
    if (!req || typeof req.method !== 'string') continue;
    if (req.id === undefined || req.id === null) continue; // notification
    try {
      const result = await dispatch(req.method, req.params);
      send({ jsonrpc: '2.0', id: req.id, result });
    } catch (err) {
      const code = typeof (err as RpcError).code === 'number' ? (err as RpcError).code : -32603;
      send({ jsonrpc: '2.0', id: req.id, error: { code, message: err instanceof Error ? err.message : String(err) } });
    }
  }
  return 0;
}
