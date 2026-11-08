// Run with: node --test load/mcp-result.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mcpCallFailed } from './mcp-result.mjs';

const ok = { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '[]' }] } };
const toolError = { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'boom' }], isError: true } };
const rpcError = { jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'Internal error' } };

test('a successful tool result is not a failure, as JSON or SSE', () => {
  assert.equal(mcpCallFailed(JSON.stringify(ok)), false);
  assert.equal(mcpCallFailed(`event: message\ndata: ${JSON.stringify(ok)}\n\n`), false);
});

test('tool errors and JSON-RPC errors count as failures even with HTTP 200', () => {
  assert.equal(mcpCallFailed(JSON.stringify(toolError)), true);
  assert.equal(mcpCallFailed(`event: message\ndata: ${JSON.stringify(toolError)}\n\n`), true);
  assert.equal(mcpCallFailed(JSON.stringify(rpcError)), true);
});

test('an empty or unreadable body counts as a failure', () => {
  assert.equal(mcpCallFailed(''), true);
  assert.equal(mcpCallFailed('not json'), true);
});
