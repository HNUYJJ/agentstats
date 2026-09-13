# Changelog

## 0.5.0 - 2026-09-13

- `agentstats limits` — the rate-limit windows Codex records in its own logs (5-hour and weekly: percent used, reset countdown, plan type), readable offline for the first time; the newest snapshot wins and stale snapshots show their age
- `rate_limits` MCP tool — agents can check their own windows before burning tokens (7 tools now)
- `agentstats install` now writes a launch strategy that actually works where it runs: the global binary is preferred (via `cmd /c` on Windows, where harnesses cannot spawn `.cmd` shims directly), with a `node <absolute dist/cli.js>` fallback when agentstats is not installed globally — `npx agentstats install codex` now produces a working registration
- `agentstats install` verifies its own work: after writing the config it spawns the exact registered command and expects a full MCP handshake + tools list (`spawn check ok (7 tools)`); `--no-verify` skips it. Failures leave the config in place but exit 1 with remediation hints
- `agentstats doctor --deep` runs the same end-to-end spawn probe on demand and reports it in human and JSON output
- fix: `install codex` now detects quoted TOML table keys (`[mcp_servers."agentstats"]`) as already-registered instead of appending a duplicate section that would corrupt the config
- tests: 47 fixture-based tests, including the launch-strategy matrix, TOML spelling variants, the end-to-end spawn check and the rate-limit parsing

## 0.4.0 - 2026-09-13

- fix(codex): `token_usage_record` events (per-response usage with a unique `response_id`, written by current Codex builds) are now the authoritative source; on a real 1.3 GB history this removes the double counting described below and corrects totals by ~6% (tokens 728M → 688M, estimated $615 → $574)
- fix(codex): consecutive `token_count` events that re-broadcast an identical `last_token_usage` (emitted at turn end) are no longer counted as extra API calls in files without records — 294 phantom events on the same history
- perf: persistent scan cache at `~/.agentstats/scan-cache-v1.json` (mtime+size keyed, atomic writes, auto-invalidated per file, `AGENTSTATS_NO_CACHE=1` to disable) — repeat CLI invocations drop from ~6 s to ~0.12 s on multi-GB histories; `doctor` reports cache stats
- perf: the Codex adapter pre-filters rollout lines (~80% skipped before `JSON.parse`) and all adapters scan concurrently — first scans are ~25% faster
- fix(gemini): JSONL sessions no longer lose timestamps (events previously landed on an `unknown` day and were invisible to `--since`/`--until`, `monthly` and budgets); lines without a timestamp inherit the file mtime
- fix(gemini): JSON sessions honour the top-level `sessionId` instead of falling back to the filename-derived id
- fix: `budget set`/`budget clear` preserve unknown keys in `~/.agentstats/config.json` instead of wiping future/advanced settings
- fix: MCP tools validate `since`/`until` as YYYY-MM-DD and return a tool error instead of silently mis-filtering
- fix: `session --limit` rejects non-numeric/negative values instead of silently defaulting to 25
- improvement: table renderer aligns CJK/fullwidth text (2-cell width) so Chinese project names no longer break column layout
- tests: 41 fixture-based tests, including token_usage_record preference, re-broadcast dedupe, gemini JSONL timestamps, persistent-cache invalidation and opt-out, config preservation and argument validation

## 0.3.0 - 2026-09-05

- `agentstats install [harness]` — one-command registration of the MCP server into Claude Code (`~/.claude.json`), Codex (`~/.codex/config.toml`), Cursor (`~/.cursor/mcp.json`) and Gemini/Antigravity CLI (`~/.gemini/settings.json`); bare `agentstats install` shows per-harness detection/configuration status
- Every install write keeps a `<file>.agentstats-backup` next to the original; unparseable foreign configs are refused untouched
- MCP robustness: `resources/*` and `prompts/*` probes answer empty instead of erroring, non-object tool arguments are rejected with -32602, and tool output is capped at 20k characters so one huge log collection cannot blow an agent's context window
- `agentstats doctor` self-tests the MCP server in-process (`mcp: ok (6 tools)`) and reports the result in `--json`

## 0.2.1 - 2026-09-05

- fix: user-supplied config is sanitized - invalid `budget` or `pricingOverrides` values are dropped instead of surfacing as NaN costs
- fix: `monthly` no longer leaks an `unknow` row for events without timestamps
- fix: `session --sort` rejects unknown keys instead of silently falling back to cost
- perf: per-file scan cache (mtime+size keyed) - `--watch` and repeated MCP tool calls no longer re-parse unchanged logs
- fix: model names with region qualifiers (`claude-opus-4-8@default`) normalize to the base model
- `doctor` and `pricing` show when the bundled price table was last fetched
- README demo output replaced with synthetic data (no personal usage stats in the repo)

## 0.2.0 - 2026-09-04

- `agentstats mcp` — expose usage, cost, budget and pricing tools to any AI agent over MCP (stdio, zero dependencies). Setup guide in the README.
- `agentstats projects` — per-project breakdown (sessions, events, tokens, cost)
- `--watch` — live dashboard mode for table commands (`--watch-interval` to tune, Ctrl+C to quit)
- `daily`/`monthly --json` now include the configured budget status
- Bundled price table auto-refreshes daily from official vendor pricing pages (Anthropic docs markdown, OpenAI standard-tier tables, Google per-model tables); LiteLLM fills models the vendors delist; per-model provenance via `agentstats pricing`
- Repo hygiene: CHANGELOG, CONTRIBUTING, issue templates

## 0.1.0 - 2026-08-29

- Initial release: daily/monthly/model/session/agent breakdowns, monthly budget guardrails (warn at 80%, exit 2 over 100%), markdown reports, `--json` everywhere, Claude Code + Codex CLI + Gemini CLI adapters, bundled price table with `pricingOverrides`
