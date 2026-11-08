import { describe, expect, it, vi } from 'vitest';

import { financialsScanEnabled, syncFinancialsScanSchedule } from './account-intel.js';

const UA = { ACCOUNT_INTEL_USER_AGENT: 'Polo intel (ops@example.test)' };

function fakeQueue(repeatables: Array<{ name: string; key: string }>) {
  return {
    add: vi.fn(async () => ({})),
    getRepeatableJobs: vi.fn(async () => repeatables),
    removeRepeatableByKey: vi.fn(async () => true),
  };
}

describe('financials scan off switch', () => {
  it('is on with a contact User-Agent and off when FINANCIALS_SCAN_ENABLED=false', () => {
    expect(financialsScanEnabled(UA)).toBe(true);
    expect(financialsScanEnabled({ ...UA, FINANCIALS_SCAN_ENABLED: 'false' })).toBe(false);
    expect(financialsScanEnabled({})).toBe(false);
  });

  it('removes a schedule left by an earlier start when the scan is disabled', async () => {
    const q = fakeQueue([
      { name: 'account-intel.sweep', key: 'sweep-key' },
      { name: 'account-intel.financials-scan', key: 'scan-key' },
    ]);
    await syncFinancialsScanSchedule(q as never, false);
    expect(q.removeRepeatableByKey).toHaveBeenCalledTimes(1);
    expect(q.removeRepeatableByKey).toHaveBeenCalledWith('scan-key');
    expect(q.add).not.toHaveBeenCalled();
  });

  it('registers the daily schedule when enabled', async () => {
    const q = fakeQueue([]);
    await syncFinancialsScanSchedule(q as never, true);
    expect(q.add).toHaveBeenCalledWith('account-intel.financials-scan', { kind: 'financials-scan' }, expect.objectContaining({ jobId: 'account-intel-financials-scan' }));
    expect(q.removeRepeatableByKey).not.toHaveBeenCalled();
  });
});
