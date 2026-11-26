// A failed ERP tool list has no tools. buildPresalesKit used to answer that
// gap with the same local-fallback sentence as a settled sidecar outage, so
// the integrations card said the local book was active. The list has not
// arrived. That is not an empty kit and it is not a local kit.
import { describe, expect, it } from 'vitest';

import { buildPresalesKit } from './erp.kit.service.js';

const LOCAL_FALLBACK = 'local Polo PreSales fallback remains active';
const UNREAD = 'The ERP tool list has not arrived.';

describe('buildPresalesKit failed tool list', () => {
  it('does not call a failed tool list a local fallback', () => {
    // WHY: the probe caught an error and passed no tools. The card prints
    // nextActions[0]. That line said the local fallback was active.
    const kit = buildPresalesKit({
      configured: true,
      reachable: false,
      tools: [],
      lastError: 'ERP MCP unavailable',
    });

    expect(kit.nextActions).toEqual([UNREAD]);
    expect(kit.nextActions.join(' ')).not.toMatch(/local Polo PreSales fallback/i);
    expect(kit.modules.map((module) => module.id)).toContain('partner-autocomplete');
    expect(kit.modules.every((module) => module.status !== 'ready')).toBe(true);
    expect(kit.modules.every((module) => module.availableTools.length === 0)).toBe(true);
    expect(kit.lastError).toBe('ERP MCP unavailable');
    expect(kit.nextActions.join(' ')).not.toContain(LOCAL_FALLBACK);
  });

  it('still says to set ERP_MCP_URL when ERP is unset and the read settled', () => {
    // WHY: a settled unset kit is not a failed probe. The set-URL line and
    // the local ready modules stay for that payload.
    const kit = buildPresalesKit({
      configured: false,
      reachable: false,
      tools: [],
      lastError: null,
    });

    expect(kit.nextActions.join(' ')).toMatch(/ERP_MCP_URL/i);
    expect(kit.nextActions.join(' ')).not.toContain(UNREAD);
    expect(kit.modules.some((module) => module.status === 'ready')).toBe(true);
    expect(kit.modules.map((module) => module.id)).toContain('partner-autocomplete');
  });

  it('still marks a module sidecar when its tools arrived', () => {
    // WHY: a tool list that arrived must stay a sidecar kit. The unread
    // line must not replace a list the probe already returned.
    const kit = buildPresalesKit({
      configured: true,
      reachable: true,
      tools: ['search_records', 'get_record'],
      lastError: null,
    });

    const partner = kit.modules.find((module) => module.id === 'partner-autocomplete');
    expect(partner?.status).toBe('sidecar');
    expect(partner?.availableTools).toEqual(['search_records', 'get_record']);
    expect(kit.nextActions.join(' ')).not.toContain(UNREAD);
    expect(kit.nextActions.join(' ')).toMatch(/res\.partner/i);
  });
});
