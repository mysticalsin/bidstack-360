/**
 * WHY: A long-lived tab must recover from an expired auth token without making
 * the user log out and back in. This browser-level gate covers the exact
 * "SERUM status is unavailable after idle" failure shape by forcing one
 * backend 401, then proving the shared API boundary retries and the page stays
 * healthy.
 */
import { test, expect } from '@playwright/test';

const DEMO_MODE = (process.env.E2E_AUTH_MODE ?? process.env.VITE_AUTH_MODE) === 'demo';
const DEMO_TOKEN = 'demo-token-idle-auth-proof';

test.describe('idle auth recovery', () => {
  test('SERUM refresh retries a stale-token rejection without showing unavailable state', async ({
    page,
  }) => {
    test.skip(!DEMO_MODE, 'Run with E2E_AUTH_MODE=demo to enable a browser token provider.');

    const serumAuthHeaders: string[] = [];
    let serumCalls = 0;

    await page.addInitScript(
      ({ token }) => {
        window.localStorage.setItem('bidstack:demo-token', token);
        window.localStorage.setItem('bidstack:demo-email', 'idle-auth-proof@bidstack.local');
        window.localStorage.setItem('bidstack:session', 'demo');
      },
      { token: DEMO_TOKEN },
    );

    await page.route('**/api/v1/**', async (route) => {
      const url = new URL(route.request().url());

      if (url.pathname.endsWith('/serum/status')) {
        serumCalls += 1;
        serumAuthHeaders.push(route.request().headers().authorization ?? '');

        if (serumCalls === 2) {
          await route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Token expired during idle tab recovery proof' }),
          });
          return;
        }

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            serumSnapshot(
              serumCalls >= 3 ? 'Recovered after forced refresh' : 'Initial live signal',
            ),
          ),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fallbackPayload(url.pathname)),
      });
    });

    await page.goto('/serum', { waitUntil: 'load' });

    await expect(page.getByRole('heading', { name: /SERUM Mission Control/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('Initial live signal')).toBeVisible();

    await page.getByRole('button', { name: /^Refresh$/i }).click();

    await expect(page.getByText('Recovered after forced refresh')).toBeVisible();
    await expect(page.getByText('SERUM status is unavailable')).not.toBeVisible();
    expect(serumCalls).toBe(3);
    expect(serumAuthHeaders).toEqual([
      `Bearer ${DEMO_TOKEN}`,
      `Bearer ${DEMO_TOKEN}`,
      `Bearer ${DEMO_TOKEN}`,
    ]);
  });
});

function serumSnapshot(detail: string) {
  const generatedAt = new Date('2026-06-17T12:00:00.000Z').toISOString();
  return {
    generatedAt,
    environment: 'test',
    enabled: true,
    demoModeEnabled: false,
    summary: {
      activeAgents: 7,
      activeLoops: 2,
      documentsProcessedToday: 12,
      failedJobs: 0,
      openApprovals: 0,
      modelCallsToday: 5,
      modelTokensToday: 12345,
      providerConfigured: true,
      dustConfigured: true,
      mcpConfigured: true,
      latestConfigChangeAt: generatedAt,
    },
    cards: [
      {
        id: 'enabled',
        title: 'Backend signal',
        value: 'Ready',
        detail,
        status: 'ready',
      },
      {
        id: 'agents',
        title: 'Agents',
        value: '7',
        detail: 'Agent personas are configured.',
        status: 'ready',
      },
      {
        id: 'loops',
        title: 'Loops',
        value: '2',
        detail: 'Autonomous loops are bounded by current guardrails.',
        status: 'active',
      },
    ],
    modules: [
      {
        id: 'mission-control',
        label: 'Mission Control',
        status: 'ready',
        detail: 'Live SERUM status recovered after the auth retry.',
      },
    ],
    providerHealth: [
      {
        provider: 'Dust',
        status: 'ready',
        latencyMs: 42,
        lastCheckedAt: generatedAt,
        message: null,
      },
    ],
    queueHealth: [
      {
        queueName: 'document-extract',
        status: 'ready',
        waiting: 0,
        active: 0,
        failed: 0,
        completed: 12,
        lastCheckedAt: generatedAt,
      },
    ],
    guardrails: [
      'Retries are bounded to one forced token refresh.',
      'Unavailable state is shown only after the forced retry fails.',
    ],
    signalHealth: [
      {
        id: 'backend-signal',
        label: 'Backend signal',
        status: 'ready',
        detail: 'The status route returned a source-backed control-plane snapshot.',
      },
    ],
  };
}

function fallbackPayload(pathname: string): unknown {
  if (pathname.endsWith('/opportunities/count')) return { count: 0 };
  if (pathname.endsWith('/tasks/summary')) {
    return { total: 0, open: 0, overdue: 0, dueSoon: 0 };
  }
  if (pathname.endsWith('/integrations/dust/status')) {
    return { configured: false, lastSyncAt: null };
  }
  return {};
}
