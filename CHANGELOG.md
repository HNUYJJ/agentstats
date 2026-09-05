# Changelog

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
