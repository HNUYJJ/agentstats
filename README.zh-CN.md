# agentstats

**AI 编程 Agent 的用量与成本统计工具。** 一条离线命令，看清楚你的 Claude Code、Codex CLI、Gemini CLI 到底烧了多少 token、折合多少钱。

[![CI](https://github.com/YOUR_USERNAME/agentstats/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_USERNAME/agentstats/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/agentstats)](https://www.npmjs.com/package/agentstats)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

```text
$ agentstats daily --since 2026-08-01
Date          Input     Output   Cache W      Cache R        Total  Cost (USD)
----------  ---------  --------  ---------  -----------  -----------  ----------
2026-08-03    581,215    69,256         0    8,733,440    9,383,911       $0.87
2026-08-05       874   190,770   427,085   17,403,264   18,021,993      $53.24
2026-08-09    739,565    94,592         0   33,588,864   34,423,021      $23.33
...
Total       9,756,223 1,354,113   427,085  232,078,080  243,615,501     $138.57

2,044 events  -  11 sessions  -  243,615,501 tokens  -  $138.57
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
| `agentstats budget set 50` | 设置每月 $50 预算（`budget` 查看、`budget clear` 清除） |
| `agentstats report --out report.md` | 导出独立 Markdown 报告 |
| `agentstats pricing` | 查看内置价目表 |
| `agentstats doctor` | 显示检测到的数据源、文件/事件数、诊断信息 |

通用过滤参数：

```bash
agentstats daily --since 2026-08-01 --until 2026-08-31
agentstats session --agent claude,codex --project my-app
agentstats models --model opus
agentstats daily --json | jq '.totals'
```

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

## 支持的工具

| 工具 | 数据源 | 状态 |
|---|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` | ✅ 完整支持 |
| Codex CLI / 桌面版 | `~/.codex/sessions/**/*.jsonl` | ✅ 完整支持 |
| Gemini CLI | `~/.gemini/tmp/**/chats/session-*.json` | ⚠️ 尽力解析——不记录用量的旧版本会被 `doctor` 明确报告 |

## FAQ

**会上传任何数据吗？** 不会。整个 CLI 零网络请求，只读本地文件。

**为什么和运营商账单对不上？** 估算用牌价；企业折扣、batch 优惠、订阅套餐都不同。它适合做相对比较和预算跟踪。

**会拖慢我的 Agent 吗？** 不会。它是按需运行的只读 CLI，Agent 完全不感知。

## Roadmap

- [ ] Cursor 及其他 IDE Agent（SQLite 日志）
- [ ] Gemini Antigravity 转录
- [ ] `--watch` 实时面板
- [ ] 非 USD 货币
- [ ] `agentstats mcp` —— 通过 MCP 把你自己的统计暴露给 Agent

欢迎贡献，尤其是价目表更新——通常就是一行改动。

## 开发

```bash
npm install
npm test        # 构建并运行测试（23 个用例，基于合成夹具）
```

## License

[MIT](./LICENSE)
