// A sync tool result that is not a record list has not arrived. OdooPlugin.sync
// counted that gap as zero created and no error, the same shape as a settled
// empty book. An empty array is that settled book. A list that arrived still counts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const callTool = vi.fn();
vi.mock('@bidstack/odoo-mcp-client', () => ({
  OdooMcpClient: class {
    callTool = callTool;
  },
}));

const { OdooPlugin } = await import('../odoo/index.js');
const { makeConfig } = await import('./helpers.js');

const UNREAD = 'The ERP record list has not arrived.';

describe('Odoo sync when the record list has not arrived', () => {
  const plugin = new OdooPlugin();

  beforeEach(() => {
    callTool.mockReset();
    vi.stubEnv('ODOO_MCP_URL', 'http://erp.example/mcp');
    vi.stubEnv('ODOO_MCP_BEARER_TOKEN', 'bearer-synthetic');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('does not call a missing record list an empty sync', async () => {
    // WHY: the sidecar answered with an object, not rows. Counting that as
    // zero created and no error says the book is empty when the list has
    // not arrived.
    callTool.mockResolvedValueOnce({ not: 'a list' });

    const res = await plugin.sync(makeConfig(), { entityTypes: ['sale.order'] });

    expect(res.created).toBe(0);
    expect(res.errors).toEqual([
      { entityType: 'sale.order', externalId: '', message: UNREAD },
    ]);
  });

  it('does not call an undefined record list an empty sync', async () => {
    // WHY: a tool result with no list is the same gap. Zero created and no
    // error would read as a healthy empty pull.
    callTool.mockResolvedValueOnce(undefined);

    const res = await plugin.sync(makeConfig(), { entityTypes: ['res.partner'] });

    expect(res.created).toBe(0);
    expect(res.errors).toEqual([
      { entityType: 'res.partner', externalId: '', message: UNREAD },
    ]);
  });

  it('keeps a settled empty record list empty', async () => {
    // WHY: an array that arrived with no rows is a real empty book. That
    // pull stays a quiet zero, not an unread error.
    callTool.mockResolvedValueOnce([]);

    const res = await plugin.sync(makeConfig(), { entityTypes: ['crm.lead'] });

    expect(res).toEqual({ created: 0, updated: 0, deleted: 0, errors: [] });
  });

  it('still counts a record list that arrived', async () => {
    // WHY: rows the sidecar already returned stay in the created count. The
    // unread line must not replace a list that arrived.
    callTool.mockResolvedValueOnce([
      { id: 'rec-1', name: 'Northwind Synthetic' },
      { id: 'rec-2', name: 'Contoso Synthetic' },
    ]);

    const res = await plugin.sync(makeConfig(), { entityTypes: ['res.partner'] });

    expect(res.created).toBe(2);
    expect(res.errors).toEqual([]);
  });
});
