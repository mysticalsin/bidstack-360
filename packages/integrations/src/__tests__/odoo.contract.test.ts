import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const callTool = vi.fn();
const ctorArgs: unknown[] = [];
vi.mock('@bidstack/odoo-mcp-client', () => ({
  OdooMcpClient: class {
    constructor(opts: unknown) {
      ctorArgs.push(opts);
    }
    callTool = callTool;
  },
}));

const { OdooPlugin } = await import('../odoo/index.js');
const { ctx, makeConfig } = await import('./helpers.js');

describe('Odoo plugin contract (mocked MCP sidecar, no real keys)', () => {
  const plugin = new OdooPlugin();

  beforeEach(() => {
    callTool.mockReset();
    ctorArgs.length = 0;
    vi.stubEnv('ODOO_MCP_URL', 'http://odoo-mcp.example.test');
    vi.stubEnv('ODOO_MCP_BEARER_TOKEN', 'bearer-fake');
    vi.stubEnv('ODOO_MCP_TIMEOUT_MS', '1234');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('getAuthUrl is empty (sidecar model, no OAuth)', async () => {
    expect(await plugin.getAuthUrl()).toBe('');
  });

  it('connect probes the sidecar and builds the client from env', async () => {
    callTool.mockResolvedValueOnce({ ok: true });
    const out = await plugin.connect(makeConfig());
    expect(callTool).toHaveBeenCalledWith('odoo_status_probe', {});
    expect(ctorArgs[0]).toEqual({ url: 'http://odoo-mcp.example.test', bearerToken: 'bearer-fake', timeoutMs: 1234 });
    expect(out.status).toBe('connected');
  });

  it('connect/validate without ODOO_MCP_URL fail fast', async () => {
    vi.stubEnv('ODOO_MCP_URL', '');
    await expect(plugin.connect(makeConfig())).rejects.toThrow(/ODOO_MCP_URL missing/);
    expect(await plugin.validate(makeConfig())).toEqual({ valid: false, message: 'ODOO_MCP_URL not set' });
    expect(callTool).not.toHaveBeenCalled();
  });

  it('validate reports probe errors as invalid', async () => {
    callTool.mockRejectedValueOnce(new Error('503 from sidecar'));
    expect(await plugin.validate(makeConfig())).toEqual({ valid: false, message: '503 from sidecar' });
  });

  it('sync reads the default models, passes the since filter, counts records and collects per-model errors', async () => {
    callTool
      .mockResolvedValueOnce([{ id: 1, name: 'A' }, { id: 2, name: 'B' }])
      .mockRejectedValueOnce(new Error('crm.lead denied'))
      .mockResolvedValueOnce({ not: 'an array' });
    const since = new Date('2026-10-01T00:00:00Z');
    const res = await plugin.sync(makeConfig(), { since });
    expect(callTool.mock.calls.map((c) => (c[1] as { model: string }).model)).toEqual([
      'res.partner',
      'crm.lead',
      'sale.order',
    ]);
    expect(callTool.mock.calls[0][1]).toMatchObject({
      domain: [['write_date', '>=', since.toISOString()]],
      fields: ['id', 'name'],
      limit: 500,
    });
    expect(res).toEqual({
      created: 2,
      updated: 0,
      deleted: 0,
      errors: [{ entityType: 'crm.lead', externalId: '', message: 'crm.lead denied' }],
    });
  });

  it('sync honours an explicit entity list', async () => {
    callTool.mockResolvedValue([]);
    await plugin.sync(makeConfig(), { entityTypes: ['project.project'] });
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool.mock.calls[0][1]).toMatchObject({ model: 'project.project', domain: [] });
  });

  it('tools forward args verbatim to the sidecar', async () => {
    callTool.mockResolvedValue([{ id: 9 }]);
    for (const tool of plugin.getTools()) {
      const args = { model: 'res.partner', name: 'Acme', limit: 3 };
      await expect(tool.execute(args, ctx(makeConfig()))).resolves.toEqual([{ id: 9 }]);
      expect(callTool).toHaveBeenLastCalledWith(tool.name, args);
    }
  });

  it('tools refuse to run when the sidecar is not configured', async () => {
    vi.stubEnv('ODOO_MCP_URL', '');
    for (const tool of plugin.getTools()) {
      await expect(tool.execute({}, ctx(makeConfig()))).rejects.toThrow('Odoo not configured');
    }
  });
});
