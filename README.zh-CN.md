# agentstats

**AI 编程 Agent 的用量与成本统计工具。** 一条离线命令，看清楚你的 Claude Code、Codex CLI、Gemini CLI 到底烧了多少 token、折合多少钱。

[![CI](https://github.com/HNUYJJ/agentstats/actions/workflows/ci.yml/badge.svg)](https://github.com/HNUYJJ/agentstats/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/agentstats)](https://www.npmjs.com/package/agentstats)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![price refresh](https://github.com/HNUYJJ/agentstats/actions/workflows/update-prices.yml/badge.svg)](https://github.com/HNUYJJ/agentstats/actions/workflows/update-prices.yml)

```text
$ agentstats daily --since 2026-08-01
Date            Input    Output  Cache W      Cache R       Total  Cost (USD)
----------  ---------  --------  ---------  ----------  ----------  ---------
2026-08-03    412,088    38,204         0    5,101,240   5,551,532       $0.61
2026-08-04    655,102   112,470   180,224   11,882,048  12,829,844       $8.42
2026-08-05  1,004,316   187,224         0   27,310,656  28,502,196      $16.90
2026-08-06  1,388,470   201,882         0   24,902,912  26,493,264      $14.02
Total       3,459,976   539,780   180,224   69,196,856  73,376,836      $39.95

312 events  -  9 sessions  -  73,376,836 tokens  -  $39.95
```

## 为什么做这个

同时使用多个编程 Agent 的人都会遇到同一个问题：token 消耗完全不可见，直到账单（或限速）砸到脸上。Claude Code、Codex CLI、Gemini CLI 其实都在本地记录了详细的用量日志，但是：

- 日志分散在三个目录、三种格式里；
- 每个工具只显示自己的用量，永远没有全局视图；
- 思考 token、缓存读、缓存写的计价各不相同，没人想手算。

`agentstats` 在本地解析这些日志，归一化成统一模型，直接回答你关心的问题：**哪一天、哪个项目、哪个模型、哪个会话**，花了多少钱。

## 特性

- **零依赖** —— 只用 Node 标准库，无任何第三方包，`npx` 秒开。
- **纯本地、完全离线** —— 只读 `~/.claude`、`~/.codex`、`~/.gemini`；不联网、不需要 API key、无遥测。
- **正确的 token 计算** —— 处理了 Anthropic 缓存写入（5m/1h TTL，1.25x/2x 计价）、OpenAI 缓存折扣、Gemini 思考 token 计费、重试消息去重、累计/增量计数器、单会话内切换模型等所有脏细节。
- **预算护栏** —— 设置月度美元预算，80% 时警告，超过 100% 退出码为 2，方便接入 CI 或 shell 提示符。
- **机器可读** —— 所有分析命令都支持 `--json`。

## 安装

```bash
npx agentstats              # 直接运行
npm i -g agentstats         # 或全局安装
```

需要 Node 18.17+。无需构建、无需配置、无需 API key。

## 命令

| 命令 | 作用 |
|---|---|
| `agentstats daily` | 按天的 token 与估算成本（默认命令） |
| `agentstats monthly` | 按月聚合 |
| `agentstats daily --breakdown model` | 二级分组：`model` / `agent` / `project` |
| `agentstats models` | 按模型统计，未定价模型标记 `*` |
| `agentstats session` | 按会话统计，默认最贵的排前面（`--limit`、`--sort`） |
| `agentstats agents` | 按工具统计（claude / codex / gemini） |
| `agentstats projects` | 按项目统计（会话、事件、token、成本） |
| `agentstats budget set 50` | 设置每月 $50 预算（`budget` 查看、`budget clear` 清除） |
| `agentstats report --out report.md` | 导出独立 Markdown 报告 |
| `agentstats pricing` | 查看内置价目表（带每个模型的来源标注） |
| `agentstats doctor` | 显示检测到的数据源、MCP 自检、诊断信息 |
| `agentstats install` | 一键把 MCP 服务器注册进 harness（claude/codex/cursor/gemini） |
| `agentstats daily --watch` | 实时面板，每隔几秒自动刷新 |
| `agentstats mcp` | 通过 MCP 把以上所有能力暴露给 AI Agent（stdio） |

通用过滤参数：

```bash
agentstats daily --since 2026-08-01 --until 2026-08-31
agentstats session --agent claude,codex --project my-app
agentstats models --model opus
agentstats daily --json | jq '.totals'
```

## 让 Agent 自己查用量

`agentstats mcp` 是一个零依赖的 [MCP](https://modelcontextprotocol.io) stdio 服务器，把你的用量数据以工具形式暴露给编程 Agent：`usage_summary`、`daily_usage`、`model_breakdown`、`top_sessions`、`budget_status`、`price_lookup`。

**一条命令落地到你的 harness**——`agentstats install` 会把 MCP 注册写进 harness 自己的配置文件（每个被修改的文件旁边都会留一个 `<file>.agentstats-backup` 备份，无法解析的外部配置会被拒绝而不是覆盖）：

```bash
agentstats install           # 查看各 harness 的检测/配置状态
agentstats install claude    # Claude Code         -> ~/.claude.json
agentstats install codex     # Codex CLI/桌面版    -> ~/.codex/config.toml
agentstats install cursor    # Cursor              -> ~/.cursor/mcp.json
agentstats install gemini    # Gemini/Antigravity  -> ~/.gemini/settings.json
```

想手动配置，或使用的 harness 不在上述列表？任何 MCP 客户端都可以：

```bash
# Claude Code
claude mcp add agentstats -- npx agentstats mcp

# Codex CLI（~/.codex/config.toml）
[mcp_servers.agentstats]
command = "agentstats"
args = ["mcp"]

# 通用 MCP 客户端（JSON）
{ "mcpServers": { "agentstats": { "command": "agentstats", "args": ["mcp"] } } }
```

配置好之后直接问 Agent："我这周在 AI 上花了多少钱？"——答案来自同一批本地日志，隐私保证与 CLI 完全一致。`agentstats doctor` 会自检 MCP 服务器，一行命令验证配置是否生效。

## 成本是怎么算的

成本是**估算值**：本地记录的 token 数 × 公开 API 牌价。订阅套餐（Claude Pro/Max、ChatGPT Plus/Pro）不是按 token 计费的——这个数字表示"等价的 API 用量值多少钱"，正好适合做预算和模型对比。

价目表在 [`src/pricing.ts`](./src/pricing.ts)，不用改代码就能覆盖：

```jsonc
// ~/.agentstats/config.json
{
  "budget": 50,
  "pricingOverrides": {
    "claude-opus-4-8": { "input": 5, "cachedInput": 0.5, "output": 25 }
  }
}
```

模型名做了强归一化（`openai/gpt-5.6-luna`、`us.anthropic.claude-sonnet-4-5:beta`、日期后缀等），一个 key 覆盖所有变体。未定价的模型标 `*` 计 $0，绝不瞎猜。

**内置价目表会自动刷新，且以官方价格为准。** 一个定时 GitHub Action 每天运行（UTC 08:00，北京时间 16:00）：解析各厂商自己的定价页——Anthropic 文档站的 markdown 原文、OpenAI 页面内嵌的定价表（仅标准档）、Google 的分模型定价表——重新生成 `src/prices.generated.ts`。每个模型都带来源标注（`official` 或 `community`），可用 `agentstats pricing` 查看。社区价格数据库（LiteLLM）只负责补齐官方页面已下架的模型；任何官方页面改版都会让刷新**大声失败**，而不是悄悄降级到第三方数据，且所有校验通过前不会写入任何内容。你亲自核实过的价格可以钉在 [`src/pricing.ts`](./src/pricing.ts) 的 `MANUAL_PRICES` 里——手动钉价优先于生成表，用户的 `pricingOverrides` 优先于一切。

## 支持的工具

| 工具 | 数据源 | 状态 |
|---|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` | ✅ 完整支持 |
| Codex CLI / 桌面版 | `~/.codex/sessions/**/*.jsonl` | ✅ 完整支持 |
| Gemini CLI（已停服，2026-06-18） | `~/.gemini/tmp/**/chats/session-*.json` | ✅ 支持读取记录了用量的历史会话 |
| Antigravity CLI / 桌面版 | — | ❌ Google 在 Antigravity 本地日志中不记录逐轮 token 用量；检测到 `~/.gemini/antigravity` 时 `doctor` 会明确说明 |

## FAQ

**会上传任何数据吗？** 不会。整个 CLI 零网络请求，只读本地文件。

**为什么和运营商账单对不上？** 估算用牌价；企业折扣、batch 优惠、订阅套餐都不同。它适合做相对比较和预算跟踪。

**会拖慢我的 Agent 吗？** 不会。它是按需运行的只读 CLI，Agent 完全不感知。

**为什么没有 Antigravity 的数据？** Antigravity（Gemini CLI 的继任者，Google 于 2026-06-18 停服 Gemini CLI）不会把逐轮 token 用量写入任何本地日志文件。`agentstats` 检测到 `~/.gemini/antigravity` 时会通过 `doctor` 明确告知这一点，而不是默默显示 $0。如果 Google 未来在本地日志或 API 中暴露用量数据，会以适配器形式支持。

## Roadmap

- [x] 定时 GitHub Action：每日自动刷新内置价目表，以官方定价页为准（`.github/scripts/update-prices.mjs`）
- [x] `agentstats mcp` —— 通过 MCP 把你自己的统计暴露给 Agent
- [x] `--watch` 实时面板
- [x] 一键安装进 Claude Code / Codex / Cursor / Gemini 配置（`agentstats install`）
- [ ] Cursor 用量接入（读取 SQLite 日志；上方的 MCP 注册与此无关、今日即可用）
- [ ] Antigravity 用量接入（如果 Google 未来在本地日志或 API 中暴露用量）
- [ ] 非 USD 货币

欢迎贡献。价格修正请把核实过的数值钉在 `MANUAL_PRICES` 里——定时刷新只重写生成条目，手动钉价不会被覆盖。参见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 开发

```bash
npm install
npm test        # 构建并运行测试（33 个用例，基于合成夹具）
```

## License

[MIT](./LICENSE)
