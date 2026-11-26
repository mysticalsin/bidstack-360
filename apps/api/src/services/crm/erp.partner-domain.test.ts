import type { OdooMcpClient as ErpMcpClient } from '@bidstack/odoo-mcp-client';
import { describe, expect, it, vi } from 'vitest';

import { searchErpPartners } from './erp.partners.service.js';

function recordingClient() {
  const searchRecords = vi.fn().mockResolvedValue([]);
  return {
    searchRecords,
    client: { searchRecords } as unknown as ErpMcpClient,
  };
}

describe('ERP partner domain for a typed hostname', () => {
  it('does not require the legal name to contain the hostname', async () => {
    // WHY: the partner box sends one typed domain as both q and domain.
    // ERP ANDs those clauses. Northwind's website is northwind.example and
    // its name is not, so the lookup comes back empty. The hostname must
    // match the website or the name.
    const { client, searchRecords } = recordingClient();

    await searchErpPartners(client, {
      q: 'northwind.example',
      domain: 'northwind.example',
      limit: 5,
    });

    expect(searchRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'res.partner',
        domain: [
          ['is_company', '=', true],
          '|',
          ['website', 'ilike', 'northwind.example'],
          ['name', 'ilike', 'northwind.example'],
        ],
      }),
    );
  });

  it('still requires both name and website when the caller set two different keys', async () => {
    // A name plus a different domain is two constraints, not one typed hostname.
    const { client, searchRecords } = recordingClient();

    await searchErpPartners(client, {
      q: 'Northwind',
      domain: 'northwind.example',
      limit: 5,
    });

    expect(searchRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: [
          ['is_company', '=', true],
          ['website', 'ilike', 'northwind.example'],
          ['name', 'ilike', 'Northwind'],
        ],
      }),
    );
  });

  it('keeps a VAT or DUNS clause on a name search', async () => {
    const { client, searchRecords } = recordingClient();

    await searchErpPartners(client, {
      q: 'Northwind',
      vat: 'FR44123456789',
      duns: '123456789',
      limit: 5,
    });

    expect(searchRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: [
          ['is_company', '=', true],
          ['vat', 'ilike', 'FR44123456789'],
          ['duns', '=', '123456789'],
          ['name', 'ilike', 'Northwind'],
        ],
      }),
    );
  });
});
