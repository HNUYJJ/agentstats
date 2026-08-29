#!/usr/bin/env node
import { existsSync, writeFileSync } from 'node:fs';
import { loadConfig, configPath, homeDir, saveConfig } from './config.js';
import { agentRows, dayKey, filterEvents, modelRows, monthKey, sessionRows, totalsOf } from './aggregate.js';
import { budgetExitCode, budgetStatus, renderBudgetLine } from './budget.js';
import { bold, dim, fmtCost, fmtInt, green, red, renderTable, setColors, yellow } from './format.js';
import { listPriceRows, normalizeModel } from './pricing.js';
import { buildReport } from './report.js';
import { scanAll, ScanResult } from './scan.js';
import { AGENT_IDS, AgentId, Config, totalTokens, Totals, UsageEvent } from './types.js';
import { VERSION } from './version.js';

const VALUE_FLAGS = new Set(['since', 'until', 'agent', 'project', 'model', 'breakdown', 'sort', 'out', 'limit', 'month']);

interface Args {
  cmd: string | null;
  flags: Record<string, string | boolean>;
  rest: string[];
}

function parseArgs(argv: string[]): Args {
  const flags: Record<string, string | boolean> = {};
  const rest: string[] = [];
  let cmd: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = (eq >= 0 ? a.slice(2, eq) : a.slice(2)).toLowerCase();
      if (VALUE_FLAGS.has(name)) {
        const val = eq >= 0 ? a.slice(eq + 1) : argv[++i];
        flags[name] = val ?? '';
      } else {
        flags[name] = true;
      }
    } else if (!cmd) {
      cmd = a;
    } else {
      rest.push(a);
    }
  }
  return { cmd, flags, rest };
}

function str(flags: Args['flags'], name: string): string | undefined {
  const v = flags[name];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function num(flags: Args['flags'], name: string): number | undefined {
  const v = str(flags, name);
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function fail(msg: string): never {
  console.error(red('error: ') + msg);
  process.exit(1);
}

function printHelp(): void {
  console.log(`agentstats v${VERSION} - usage & cost analytics for AI coding agents

${bold('Usage:')} agentstats <command> [options]

${bold('Commands:')}
  daily              tokens & cost per day (default command)
  monthly            tokens & cost per month
  models             breakdown by model
  session            breakdown by session (top spenders first)
  agents             breakdown by agent (claude / codex / gemini)
  budget             set or check a monthly USD budget
  report             export a markdown report
  pricing            show the bundled price table
  doctor             show detected data sources and diagnostics

${bold('Options:')}
  --since DATE       only include days >= YYYY-MM-DD (local time)
  --until DATE       only include days <= YYYY-MM-DD
  --agent LIST       comma-separated subset: claude,codex,gemini
  --project STR      filter by project name substring
  --model STR        filter by model name substring
  --breakdown X      daily/monthly second grouping: model | agent | project | none
  --limit N          max rows in the session table (default 25, 0 = all)
  --sort KEY         session sort: cost (default) | tokens | date
  --month YYYY-MM    budget month (default: current)
  --out FILE         write report to a file instead of stdout
  --json             machine-readable JSON output
  --no-color         disable colors

${bold('Examples:')}
  agentstats                                   # day-by-day for all time
  agentstats daily --breakdown model --since 2026-08-01
  agentstats budget set 50                     # $50/month, warns at 80%
  agentstats report --out august.md --since 2026-08-01

All data is read locally from ~/.claude, ~/.codex and ~/.gemini.
Nothing is uploaded, no API keys, no network access, works fully offline.
Costs are estimates from public API list prices - configure overrides in
${configPath()} when a model is unpriced.`);
}

interface Loaded {
  events: UsageEvent[];
  all: UsageEvent[];
  scan: ScanResult;
  cfg: Config;
  home: string;
}

async function load(flags: Args['flags'], home: string): Promise<Loaded> {
  const agentArg = str(flags, 'agent');
  let only: AgentId[] | undefined;
  if (agentArg) {
    only = agentArg.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) as AgentId[];
    const bad = only.filter((a) => !AGENT_IDS.includes(a));
    if (bad.length) fail(`unknown agent(s): ${bad.join(', ')} (supported: ${AGENT_IDS.join(', ')})`);
  }
  for (const k of ['since', 'until'] as const) {
    const v = str(flags, k);
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) fail(`--${k} must be YYYY-MM-DD, got: ${v}`);
  }
  const scan = await scanAll(home, only);
  const events = filterEvents(scan.events, {
    since: str(flags, 'since'),
    until: str(flags, 'until'),
    project: str(flags, 'project'),
    model: str(flags, 'model'),
  });
  return { events, all: scan.events, scan, cfg: loadConfig(home), home };
}

function tokensOf(t: Totals): number {
  return totalTokens(t);
}

function metaLine(l: Loaded): string {
  const sessions = new Set(l.events.map((e) => `${e.agent}/${e.sessionId}`)).size;
  const parts = [
    `${fmtInt(l.events.length)} events`,
    `${fmtInt(sessions)} sessions`,
    `${fmtInt(tokensOf(totalsOf(l.events, l.cfg)))} tokens`,
    fmtCost(totalsOf(l.events, l.cfg).cost),
  ];
  return dim(parts.join('  -  '));
}

function cmdDaily(l: Loaded, flags: Args['flags'], monthly: boolean): number {
  const json = !!flags.json;
  const keyFn = monthly ? monthKey : dayKey;
  const br = str(flags, 'breakdown');
  if (br && !['model', 'agent', 'project', 'none'].includes(br)) {
    fail(`--breakdown must be model, agent, project or none, got: ${br}`);
  }
  const breakdown = br && br !== 'none' ? (br as 'model' | 'agent' | 'project') : null;

  const byPeriod = new Map<string, UsageEvent[]>();
  for (const e of l.events) {
    const k = keyFn(e.ts);
    (byPeriod.get(k) ?? byPeriod.set(k, []).get(k)!).push(e);
  }
  const keys = [...byPeriod.keys()].filter((k) => k !== 'unknown').sort();

  const labelHeader = breakdown === 'model' ? 'Model' : breakdown === 'agent' ? 'Agent' : 'Project';
  const headers = [monthly ? 'Month' : 'Date', ...(breakdown ? [labelHeader] : []), 'Input', 'Output', 'Cache W', 'Cache R', 'Total', 'Cost (USD)'];

  const rows: string[][] = [];
  const jsonRows: Record<string, unknown>[] = [];

  for (const k of keys) {
    const evs = byPeriod.get(k)!;
    const groups: Array<[string, UsageEvent[]]> = breakdown
      ? groupByFieldSortedByCost(evs, breakdown, l.cfg)
      : [['', evs]];
    for (const [label, list] of groups) {
      const t = totalsOf(list, l.cfg);
      const row = [k, ...(breakdown ? [label] : []), fmtInt(t.input), fmtInt(t.output), fmtInt(t.cacheWrite5m + t.cacheWrite1h), fmtInt(t.cacheRead), fmtInt(tokensOf(t)), green(fmtCost(t.cost))];
      rows.push(row);
      if (json) {
        const jr: Record<string, unknown> = monthly ? { month: k } : { date: k };
        if (breakdown) jr[breakdown] = label;
        jr.input = t.input;
        jr.output = t.output;
        jr.cacheWrite = t.cacheWrite5m + t.cacheWrite1h;
        jr.cacheRead = t.cacheRead;
        jr.totalTokens = tokensOf(t);
        jr.costUsd = t.cost;
        jsonRows.push(jr);
      }
    }
  }

  const t = totalsOf(l.events, l.cfg);
  if (json) {
    console.log(JSON.stringify({
      rows: jsonRows,
      totals: { input: t.input, output: t.output, cacheWrite: t.cacheWrite5m + t.cacheWrite1h, cacheRead: t.cacheRead, totalTokens: tokensOf(t), costUsd: t.cost },
    }, null, 2));
    return 0;
  }
  if (!rows.length) {
    console.log(dim('no usage found for the given filters'));
    return 0;
  }
  const totalRow = [bold('Total'), ...(breakdown ? [''] : []), bold(fmtInt(t.input)), bold(fmtInt(t.output)), bold(fmtInt(t.cacheWrite5m + t.cacheWrite1h)), bold(fmtInt(t.cacheRead)), bold(fmtInt(tokensOf(t))), bold(green(fmtCost(t.cost)))];
  console.log(renderTable(headers, [...rows, totalRow]));
  console.log();
  console.log(metaLine(l));
  const b = budgetStatus(l.all, l.cfg);
  if (b) {
    console.log(renderBudgetLine(b));
    return budgetExitCode(b);
  }
  return 0;
}

function groupByFieldSortedByCost(evs: UsageEvent[], field: 'model' | 'agent' | 'project', cfg: Config): Array<[string, UsageEvent[]]> {
  const map = new Map<string, UsageEvent[]>();
  for (const e of evs) {
    const k = String((e as unknown as Record<string, unknown>)[field] ?? 'unknown');
    (map.get(k) ?? map.set(k, []).get(k)!).push(e);
  }
  return [...map.entries()].sort((a, b) => totalsOf(b[1], cfg).cost - totalsOf(a[1], cfg).cost);
}

function cmdModels(l: Loaded, flags: Args['flags']): number {
  const rows = modelRows(l.events, l.cfg);
  if (flags.json) {
    console.log(JSON.stringify(rows.map((r) => ({
      model: r.model,
      priced: r.priced,
      events: r.totals.events,
      input: r.totals.input,
      output: r.totals.output,
      cacheWrite: r.totals.cacheWrite5m + r.totals.cacheWrite1h,
      cacheRead: r.totals.cacheRead,
      totalTokens: tokensOf(r.totals),
      costUsd: r.totals.cost,
    })), null, 2));
    return 0;
  }
  if (!rows.length) {
    console.log(dim('no usage found'));
    return 0;
  }
  const unpriced = rows.filter((r) => !r.priced);
  const table = rows.map((r) => [
    r.priced ? r.model : yellow(r.model + ' *'),
    fmtInt(r.totals.input + r.totals.cacheRead + r.totals.cacheWrite5m + r.totals.cacheWrite1h),
    fmtInt(r.totals.output),
    fmtInt(r.totals.cacheRead + r.totals.cacheWrite5m + r.totals.cacheWrite1h),
    fmtInt(r.totals.events),
    green(fmtCost(r.totals.cost)),
  ]);
  console.log(renderTable(['Model', 'Tokens', 'Output', 'Cache', 'Events', 'Cost (USD)'], table));
  console.log();
  console.log(metaLine(l));
  if (unpriced.length) {
    console.log(yellow(`* pricing unknown for: ${unpriced.map((u) => normalizeModel(u.model)).join(', ')}`));
    console.log(dim(`  set pricingOverrides in ${configPath(l.home)} or send a PR to improve the bundled table`));
  }
  return 0;
}

function cmdSession(l: Loaded, flags: Args['flags']): number {
  const rows = sessionRows(l.events, l.cfg);
  const sort = str(flags, 'sort') ?? 'cost';
  if (sort === 'tokens') rows.sort((a, b) => tokensOf(b.totals) - tokensOf(a.totals));
  else if (sort === 'date') rows.sort((a, b) => b.date.localeCompare(a.date) || b.totals.cost - a.totals.cost);
  const limit = num(flags, 'limit') ?? 25;
  const shown = limit > 0 ? rows.slice(0, limit) : rows;
  if (flags.json) {
    console.log(JSON.stringify(rows.map((r) => ({
      session: r.session,
      date: r.date,
      agent: r.agent,
      project: r.project,
      model: r.model,
      models: r.modelCount,
      totalTokens: tokensOf(r.totals),
      costUsd: r.totals.cost,
    })), null, 2));
    return 0;
  }
  if (!shown.length) {
    console.log(dim('no usage found'));
    return 0;
  }
  const table = shown.map((r) => [
    dim(r.session.slice(0, 12)),
    r.date,
    r.agent,
    r.project.length > 40 ? r.project.slice(0, 40) : r.project,
    r.modelCount > 1 ? `${r.model} (+${r.modelCount - 1})` : r.model,
    fmtInt(tokensOf(r.totals)),
    green(fmtCost(r.totals.cost)),
  ]);
  console.log(renderTable(['Session', 'Date', 'Agent', 'Project', 'Model', 'Tokens', 'Cost (USD)'], table));
  console.log();
  if (limit > 0 && rows.length > shown.length) console.log(dim(`showing top ${shown.length} of ${rows.length} sessions - use --limit 0 for all`));
  console.log(metaLine(l));
  return 0;
}

function cmdAgents(l: Loaded, flags: Args['flags']): number {
  const rows = agentRows(l.events, l.cfg);
  if (flags.json) {
    console.log(JSON.stringify(rows.map((r) => ({
      agent: r.agent,
      sessions: r.sessions,
      events: r.totals.events,
      tokens: tokensOf(r.totals),
      costUsd: r.totals.cost,
    })), null, 2));
    return 0;
  }
  if (!rows.length) {
    console.log(dim('no usage found'));
    return 0;
  }
  const table = rows.map((r) => [
    r.agent,
    fmtInt(r.sessions),
    fmtInt(r.totals.events),
    fmtInt(tokensOf(r.totals)),
    green(fmtCost(r.totals.cost)),
  ]);
  console.log(renderTable(['Agent', 'Sessions', 'Events', 'Tokens', 'Cost (USD)'], table));
  console.log();
  console.log(metaLine(l));
  return 0;
}

function cmdBudget(l: Loaded, flags: Args['flags'], rest: string[]): number {
  const sub = rest[0];
  const cfg = l.cfg;
  if (sub === 'set') {
    const amount = Number(rest[1]);
    if (!Number.isFinite(amount) || amount <= 0) fail('usage: agentstats budget set <usd-amount>');
    saveConfig({ ...cfg, budget: amount }, l.home);
    console.log(green(`monthly budget set to ${fmtCost(amount)} (stored in ${configPath(l.home)})`));
    return 0;
  }
  if (sub === 'clear' || sub === 'off') {
    delete cfg.budget;
    saveConfig(cfg, l.home);
    console.log('monthly budget cleared');
    return 0;
  }
  const month = str(flags, 'month');
  if (month && !/^\d{4}-\d{2}$/.test(month)) fail('--month must be YYYY-MM');
  const status = budgetStatus(l.all, cfg, month);
  if (flags.json) {
    console.log(JSON.stringify(status, null, 2));
    return budgetExitCode(status);
  }
  if (!status) {
    console.log('no budget configured - set one with: agentstats budget set <usd-amount>');
    return 0;
  }
  console.log(renderBudgetLine(status));
  console.log();
  console.log(metaLine(l));
  return budgetExitCode(status);
}

function cmdReport(l: Loaded, flags: Args['flags']): number {
  const md = buildReport(l.events, l.cfg, {
    since: str(flags, 'since'),
    until: str(flags, 'until'),
    month: str(flags, 'month'),
  });
  const out = str(flags, 'out');
  if (out) {
    writeFileSync(out, md, 'utf8');
    console.log(green(`report written to ${out}`));
  } else {
    process.stdout.write(md);
  }
  return 0;
}

function cmdPricing(flags: Args['flags'], home: string): number {
  const cfg = loadConfig(home);
  const entries = listPriceRows(cfg.pricingOverrides);
  if (flags.json) {
    console.log(JSON.stringify(entries, null, 2));
    return 0;
  }
  const strip = (n: number) => '$' + n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0');
  const table = entries.map((r) => [
    r.model,
    strip(r.price.input),
    strip(r.price.cachedInput ?? r.price.input * 0.1),
    strip(r.price.output),
    r.source === 'bundled' ? dim(r.source) : r.source,
  ]);
  console.log(renderTable(['Model', 'Input /MTok', 'Cached /MTok', 'Output /MTok', 'Source'], table, { aligns: ['l', 'r', 'r', 'r', 'l'] }));
  console.log();
  console.log(dim('prices in USD per 1M tokens; override them via "pricingOverrides" in ' + configPath(home)));
  return 0;
}

function cmdDoctor(l: Loaded, flags: Args['flags']): number {
  if (flags.json) {
    console.log(JSON.stringify({ version: VERSION, home: l.home, configPath: configPath(l.home), config: l.cfg, sources: l.scan.sources }, null, 2));
    return 0;
  }
  console.log(`agentstats v${VERSION}`);
  console.log(`home:   ${l.home}`);
  console.log(`config: ${configPath(l.home)} ${existsSync(configPath(l.home)) ? '' : dim('(not created yet)')}`);
  console.log('');
  for (const s of l.scan.sources) {
    const status = s.exists ? green('found') : yellow('not found');
    console.log(`[${s.agent}] ${dim(s.root)}`);
    console.log(`  ${status} - ${fmtInt(s.files)} file(s), ${fmtInt(s.events)} usage event(s)`);
    if (s.latestTs) console.log(`  latest activity: ${new Date(s.latestTs).toISOString()}`);
    for (const n of s.notes) console.log(yellow(`  note: ${n}`));
  }
  const unpriced = modelRows(l.all, l.cfg).filter((m) => !m.priced).map((m) => normalizeModel(m.model));
  if (unpriced.length) {
    console.log('');
    console.log(yellow(`unpriced models: ${unpriced.join(', ')}`));
    console.log(dim(`fix via pricingOverrides in ${configPath(l.home)}`));
  }
  return 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  setColors((process.stdout.isTTY && !process.env.NO_COLOR && !args.flags['no-color']) || !!args.flags.color);

  if (args.flags.version) {
    console.log(VERSION);
    return 0;
  }
  if (args.flags.help || args.cmd === 'help') {
    printHelp();
    return 0;
  }
  const cmd = args.cmd ?? 'daily';

  switch (cmd) {
    case 'daily':
    case 'monthly': {
      const l = await load(args.flags, homeDir());
      return cmdDaily(l, args.flags, cmd === 'monthly');
    }
    case 'models': {
      const l = await load(args.flags, homeDir());
      return cmdModels(l, args.flags);
    }
    case 'session':
    case 'sessions': {
      const l = await load(args.flags, homeDir());
      return cmdSession(l, args.flags);
    }
    case 'agents': {
      const l = await load(args.flags, homeDir());
      return cmdAgents(l, args.flags);
    }
    case 'budget': {
      const l = await load(args.flags, homeDir());
      return cmdBudget(l, args.flags, args.rest);
    }
    case 'report': {
      const l = await load(args.flags, homeDir());
      return cmdReport(l, args.flags);
    }
    case 'pricing':
      return cmdPricing(args.flags, homeDir());
    case 'doctor': {
      const l = await load(args.flags, homeDir());
      return cmdDoctor(l, args.flags);
    }
    default:
      console.error(red(`unknown command: ${cmd}`));
      console.error("run 'agentstats --help' for usage");
      return 1;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error(red('error: ') + (err instanceof Error ? err.stack ?? err.message : String(err)));
    process.exitCode = 1;
  });
