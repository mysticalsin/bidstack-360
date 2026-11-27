// The rewrite is only the news-scan marker. A deal path and the stored
// task-list marker stay as sent, so this does not take over those opens.
import { describe, expect, it } from 'vitest';

import { accountNewsAlertPath } from './account-news-alert-path';

const FIXTURE_ACCOUNT = 'c0000000-0000-4000-8000-000000000001';

describe('accountNewsAlertPath', () => {
  it('sends the fixture news marker to that account watchdog', () => {
    expect(accountNewsAlertPath(`/dashboard?account=${FIXTURE_ACCOUNT}#watchdog`)).toBe(
      `/accounts/${FIXTURE_ACCOUNT}#watchdog`,
    );
  });

  it('accepts an encoded account id and still drops a non-uuid', () => {
    expect(
      accountNewsAlertPath(`/dashboard?account=${encodeURIComponent(FIXTURE_ACCOUNT)}#watchdog`),
    ).toBe(`/accounts/${FIXTURE_ACCOUNT}#watchdog`);
    expect(accountNewsAlertPath('/dashboard?account=not-an-account#watchdog')).toBe(
      '/dashboard?account=not-an-account#watchdog',
    );
  });

  it('leaves a deal URL, a task-list marker, and a null URL as sent', () => {
    expect(accountNewsAlertPath('/opportunities/00000000-0000-4000-8000-000000020041')).toBe(
      '/opportunities/00000000-0000-4000-8000-000000020041',
    );
    expect(
      accountNewsAlertPath('/tasks?taskId=00000000-0000-4000-8000-000000010001&due=2026-11-25'),
    ).toBe('/tasks?taskId=00000000-0000-4000-8000-000000010001&due=2026-11-25');
    expect(accountNewsAlertPath(null)).toBeNull();
  });
});
