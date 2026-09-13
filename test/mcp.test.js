import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { distCli, fixturesHome } from './helpers.js';

function mcpSession(msgs) {
  return spawnSync(process.execPath, [distCli, 'mcp'], {
    input: msgs.map((m) => JSON.stringify(m)).join('\n') + '\n',
    env: { ...process.env, AGENTSTATS_HOME: fixturesHome, NO_COLOR: '1' },
    encoding: 'utf8',
    timeout: 30_000,
  });
}

test('mcp server: initialize, tools/list, tools/call, error codes', () => {
  const r = mcpSession([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'daily_usage', arguments: {} } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'price_lookup', arguments: { model: 'claude-sonnet-4-5' } } },
    { jsonrpc: '2.0', id: 5, method: 'bogus/method' },
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'no_such_tool', arguments: {} } },
    { jsonrpc: '2.0', id: 7, method: 'resources/list' },
    { jsonrpc: '2.0', id: 8, method: 'prompts/list' },
    { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'daily_usage', arguments: 'oops' } },
    { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'daily_usage', arguments: { since: 'not-a-date' } } },
    { jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'rate_limits', arguments: {} } },
  ]);
  assert.equal(r.status, 0, r.stderr);

  const byId = new Map(
    r.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((m) => [m.id, m])
  );

  const init = byId.get(1);
  assert.equal(init.result.serverInfo.name, 'agentstats');
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.ok(init.result.capabilities.tools);

  const tools = byId.get(2).result.tools;
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    ['budget_status', 'daily_usage', 'model_breakdown', 'price_lookup', 'rate_limits', 'top_sessions', 'usage_summary']
  );
  for (const t of tools) {
    assert.ok(t.description, `${t.name} needs a description`);
    assert.equal(t.inputSchema.type, 'object');
  }

  const daily = byId.get(3).result;
  assert.ok(!daily.isError);
  assert.ok(daily.content[0].text.includes('2026-08-20'));
  assert.ok(daily.content[0].text.includes('Cost'));

  const price = byId.get(4).result.content[0].text;
  assert.ok(price.includes('claude-sonnet-4-5'));
  assert.ok(price.includes('$3/MTok'));

  assert.equal(byId.get(5).error.code, -32601);
  assert.equal(byId.get(6).error.code, -32602);

  // probed capabilities we do not offer answer empty, not an error
  assert.deepEqual(byId.get(7).result.resources, []);
  assert.deepEqual(byId.get(8).result.prompts, []);
  assert.equal(byId.get(9).error.code, -32602); // non-object arguments refused

  // malformed dates are refused with a tool error, not silently ignored
  const badDate = byId.get(10).result;
  assert.ok(badDate.isError);
  assert.ok(badDate.content[0].text.includes('YYYY-MM-DD'));

  // rate limits surface the newest Codex snapshot (79% of the 5h window)
  const limits = byId.get(11).result;
  assert.ok(!limits.isError, limits.content?.[0]?.text);
  assert.ok(limits.content[0].text.includes('79%'));
  assert.ok(limits.content[0].text.includes('5h window'));

  // notifications must never produce a response line
  assert.ok(!r.stdout.includes('"notifications/initialized"'));
});
