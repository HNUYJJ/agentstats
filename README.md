# agentstats

**Usage & cost analytics for AI coding agents.** Know exactly how many tokens your Claude Code, Codex CLI and Gemini CLI sessions burn — and what they would have cost — with a single offline command.

[![CI](https://github.com/YOUR_USERNAME/agentstats/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_USERNAME/agentstats/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/agentstats)](https://www.npmjs.com/package/agentstats)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![node](https://img.shields.io/node/v/agentstats)](./package.json)
[![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](./package.json)

```text
$ agentstats daily --since 2026-08-01
Date          Input     Output   Cache W      Cache R        Total  Cost (USD)
----------  ---------  --------  ---------  -----------  -----------  ----------
2026-08-03    581,215    69,256         0    8,733,440    9,383,911       $0.87
2026-08-05       874   190,770   427,085   17,403,264   18,021,993      $53.24
2026-08-09    739,565    94,592         0   33,588,864   34,423,021      $23.33
2026-08-19  2,057,776   265,808         0   50,310,656   52,634,240      $17.37
...
Total       9,756,223 1,354,113   427,085  232,078,080  243,615,501     $138.57

2,044 events  -  11 sessions  -  243,615,501 tokens  -  $138.57
```

## Why

If you run multiple coding agents, you already have the problem: token spend is invisible until the invoice (or the rate limit) hits. Claude Code, Codex CLI and Gemini CLI each record detailed usage in local transcript logs, but:

- the logs are scattered across three different directories in three different formats,
- each tool only shows its own usage, never the combined picture,
- thinking tokens, cache reads and cache writes are priced differently and nobody wants to do that math.

`agentstats` parses all of those logs locally, normalizes them into one model, and answers the questions you actually care about: *which day, which project, which model, which session* — and how much.

## Highlights

- **Zero dependencies** — one static TypeScript bundle on top of the Node standard library. Nothing to audit, instant `npx`.
- **100% local & offline** — reads `~/.claude`, `~/.codex`, `~/.gemini`; no network access, no API keys, no telemetry. Your transcripts never leave the machine.
- **Correct token math** — handles Anthropic cache writes (1.25x/2x input, 5m/1h TTL), OpenAI cached-input discounts, Gemini thinking-token billing, retried-message dedupe, cumulative-vs-delta token counters, and per-session model switching.
- **Budget guardrails** — set a monthly USD budget; `agentstats` warns at 80% and exits with code 2 past 100%, so your CI or shell prompt can react.
- **Machine-readable** — `--json` on every analytical command for scripting and dashboards.

## Install

```bash
npx agentstats              # run once
npm i -g agentstats         # or install globally
```

Requires Node 18.17+. No build, no config, no API keys.

## Commands

| Command | What it shows |
|---|---|
| `agentstats daily` | tokens & estimated cost per day (default command) |
| `agentstats monthly` | same, grouped by month |
| `agentstats daily --breakdown model` | second grouping: `model`, `agent` or `project` |
| `agentstats models` | per-model totals, flags unpriced models with `*` |
| `agentstats session` | per-session totals, top spenders first (`--limit`, `--sort`) |
| `agentstats agents` | per-agent totals (claude / codex / gemini) |
| `agentstats budget set 50` | track a $50/month budget (`budget`, `budget clear`) |
| `agentstats report --out report.md` | export a standalone markdown report |
| `agentstats pricing` | the bundled price table |
| `agentstats doctor` | which sources were found, file/event counts, notes |

Common filters work everywhere:

```bash
agentstats daily --since 2026-08-01 --until 2026-08-31
agentstats session --agent claude,codex --project my-app
agentstats models --model opus
agentstats daily --json | jq '.totals'
```

## How costs are estimated

Costs are **estimates**: locally recorded token counts × public API list prices. Subscription plans (Claude Pro/Max, ChatGPT Plus/Pro) are not billed per token — the numbers show what equivalent API usage would have cost, which is exactly what you want for budgeting and comparing models.

Prices live in a single flat table in [`src/pricing.ts`](./src/pricing.ts) and can be overridden without touching the code:

```jsonc
// ~/.agentstats/config.json
{
  "budget": 50,
  "pricingOverrides": {
    "claude-opus-4-8": { "input": 5, "cachedInput": 0.5, "output": 25 }
  }
}
```

Model names are normalized aggressively (`openai/gpt-5.6-luna`, `us.anthropic.claude-sonnet-4-5:beta`, date suffixes), so one key covers the variants. Unpriced models are flagged with `*` and cost $0 rather than being guessed.

## Supported tools

| Agent | Source | Status |
|---|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` | ✅ full |
| Codex CLI / desktop | `~/.codex/sessions/**/*.jsonl` | ✅ full |
| Gemini CLI | `~/.gemini/tmp/**/chats/session-*.json` | ⚠️ best-effort — versions that don't record usage are detected and reported by `doctor` |

## FAQ

**Is any data uploaded?** No. The CLI performs zero network I/O. Point `doctor` at a fresh machine and you'll see it only ever reads local files.

**Where does it read from?** `~/.claude/projects`, `~/.codex/sessions` (plus `archived_sessions`), `~/.gemini/tmp`. Override the home root with the `AGENTSTATS_HOME` environment variable.

**Does it slow my agent down?** No. It's a read-only CLI you run on demand; agents never touch it.

**Why do my numbers differ from my provider invoice?** Estimates use list prices; enterprise rates, batch discounts, subscriptions and rate-limit windows differ. Use them for relative comparisons and budget tracking.

## Roadmap

- [ ] Cursor & other IDE agents (SQLite-backed logs)
- [ ] Gemini Antigravity transcripts
- [ ] `--watch` live dashboard mode
- [ ] Non-USD currencies
- [ ] `agentstats mcp` — expose your own stats to your agents via MCP

Contributions are welcome — especially price-table updates, which are a one-line change.

## Development

```bash
npm install
npm test        # builds and runs the test suite (23 tests, fixture-based)
```

The test suite parses synthetic fixture logs covering dedupe, cache-write splits, cumulative counters and model switching — no real transcripts are needed or used.

## 中文文档

见 [README.zh-CN.md](./README.zh-CN.md)。

## License

[MIT](./LICENSE)
