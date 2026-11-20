/**
 * Scenario definitions for load/run.mjs. Each scenario is one autocannon
 * target: a base URL, shared headers and a request list that every
 * connection cycles through.
 */
import { randomUUID } from 'node:crypto';

import { mcpCallFailed } from './mcp-result.mjs';

const JSON_HEADERS = { 'content-type': 'application/json' };

async function api(apiUrl, role, method, url, body) {
  const res = await fetch(`${apiUrl}${url}`, {
    method,
    headers: { ...JSON_HEADERS, 'x-bidstack-e2e-role': role },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/** Create an MCP API key through the API, then open one MCP session. */
async function mcpSession(apiUrl, mcpUrl, role) {
  try {
    const health = await fetch(`${mcpUrl}/health`);
    if (!health.ok) return { skip: `MCP health ${health.status}` };
  } catch {
    return { skip: `MCP server not reachable at ${mcpUrl}` };
  }
  const key = await api(apiUrl, role, 'POST', '/api/v1/integrations/api-keys', {
    name: `load-${Date.now()}`,
    scopes: ['mcp', 'read'],
    readOnly: true,
    unrestrictedScope: true,
  });
  const headers = {
    authorization: `Bearer ${key.secret}`,
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  const init = await fetch(`${mcpUrl}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'polo-load', version: '1.0.0' },
      },
    }),
  });
  const sessionId = init.headers.get('mcp-session-id');
  await init.text();
  if (!sessionId) return { skip: `MCP initialize returned ${init.status} without a session id` };
  await fetch(`${mcpUrl}/mcp`, {
    method: 'POST',
    headers: { ...headers, 'mcp-session-id': sessionId },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  }).then((r) => r.text());
  return { headers: { ...headers, 'mcp-session-id': sessionId } };
}

export async function buildScenarios({ apiUrl, mcpUrl, role }) {
  const headers = { ...JSON_HEADERS, 'x-bidstack-e2e-role': role };
  const opps = await api(apiUrl, role, 'GET', '/api/v1/opportunities?limit=5');
  const oppItems = opps.items ?? opps.data ?? opps;
  const oppId = Array.isArray(oppItems) && oppItems[0] ? oppItems[0].id : null;
  const accountId = 'load-test-account';

  const get = (path) => ({ method: 'GET', path });
  const post = (path, body) => ({
    method: 'POST',
    path,
    // A fresh body per request so writes never collapse into duplicates.
    setupRequest: (req) => ({ ...req, body: JSON.stringify(body()) }),
  });

  const mcp = await mcpSession(apiUrl, mcpUrl, role);
  const mcpAppErrors = { count: 0 };
  const tool = (name, args) => ({
    method: 'POST',
    path: '/mcp',
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
    onResponse: (status, body) => {
      if (status < 400 && mcpCallFailed(body)) mcpAppErrors.count += 1;
    },
  });

  return [
    {
      name: 'dashboard',
      url: apiUrl,
      headers,
      requests: [
        get('/api/v1/crm/dashboard'),
        get('/api/v1/crm/summary'),
        get('/api/v1/opportunities?limit=50'),
        get('/api/v1/leads?limit=50'),
        get('/api/v1/contacts?limit=50'),
        get('/api/v1/tasks?limit=50'),
        get('/api/v1/notifications'),
        get('/api/v1/activities?limit=50'),
      ],
    },
    {
      name: 'write',
      url: apiUrl,
      headers,
      requests: [
        post('/api/v1/notes', () => ({
          accountId,
          title: `Load note ${randomUUID().slice(0, 8)}`,
          bodyMd: 'Stress suite note.',
        })),
        post('/api/v1/tasks', () => ({
          oppId,
          title: `Load task ${randomUUID().slice(0, 8)}`,
          dueDate: null,
          assignee: null,
          status: 'open',
        })),
        post('/api/v1/contacts', () => ({
          name: `Load Contact ${randomUUID().slice(0, 8)}`,
          email: `load-${randomUUID()}@example.test`,
          customer: 'Load Test Co',
          role: null,
          phone: null,
          influence: null,
          sentiment: null,
        })),
      ],
    },
    {
      name: 'search',
      url: apiUrl,
      headers,
      requests: [
        get('/api/v1/crm/companies/search?q=ma&limit=20'),
        get('/api/v1/search?q=mantu&limit=20'),
        get('/api/v1/msa/search?q=service&limit=20'),
      ],
    },
    {
      name: 'export',
      url: apiUrl,
      headers,
      requests: [get('/api/v1/opportunities/export')],
    },
    {
      name: 'mcp',
      url: mcpUrl,
      skip: mcp.skip,
      headers: mcp.headers,
      appErrors: mcpAppErrors,
      requests: [
        tool('opportunities.list', { limit: 50 }),
        tool('contacts.list', { limit: 50 }),
        tool('tasks.list', { limit: 50 }),
      ],
    },
  ];
}
