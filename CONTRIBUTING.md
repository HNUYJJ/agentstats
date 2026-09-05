# Contributing

Thanks for considering a contribution!

## Development

```bash
npm install
npm test        # build + fixture-based test suite; no real transcripts needed
```

Quick architecture tour:

- `src/adapters/` — one module per supported agent; each parses local logs into normalized `UsageEvent`s
- `src/aggregate.ts` — grouping/filtering helpers shared by the CLI and the MCP server
- `src/pricing.ts` + `src/prices.generated.ts` — model-name normalization, price lookup, cost math; the generated table is auto-refreshed by a scheduled GitHub Action
- `src/cli.ts` — the command surface; `src/mcp.ts` — the MCP stdio server
- `test/fixtures/home/` — synthetic `~/.claude`, `~/.codex`, `~/.gemini` trees used by the tests

Rules of the road:

- **Runtime dependencies stay at zero** — Node stdlib only.
- **Tests must not depend on the calendar date** or on specific prices in the bundled table (it is auto-refreshed nightly). If a test needs prices, pin them via `test/fixtures/home/.agentstats/config.json`; if it needs dates, use the `tmpHome()` helper which rewrites fixture dates into the current month.
- **New agent adapter**: add `src/adapters/<agent>.ts` exporting the same shape as the existing ones, register it in `src/adapters/index.ts`, add fixture logs under `test/fixtures/` and tests. Include a note in the README's supported-tools table.
- Shell output stays ASCII (no fancy unicode) so Windows consoles with legacy code pages don't garble it.

## Price corrections

The scheduled refresh only ever rewrites `src/prices.generated.ts`. To correct a price you have verified against the vendor, add it to `MANUAL_PRICES` in `src/pricing.ts` — pins survive refreshes. Please never edit the generated file by hand.

## Reporting issues

Use the issue templates. For wrong costs, include `agentstats doctor` output and the model name. Never paste transcript contents — they are not needed and may contain private data.
