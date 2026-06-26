import * as Sentry from '@sentry/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SENTRY_UNAUTHENTICATED_ORG_TAG,
  initSentry,
  scrubSentryBrowserEvent,
  setSentryUser,
} from './sentry';

vi.mock('@sentry/react', () => ({
  init: vi.fn(),
  browserTracingIntegration: vi.fn(() => ({ name: 'browserTracing' })),
  replayIntegration: vi.fn((options: Record<string, unknown>) => ({ name: 'replay', options })),
  setUser: vi.fn(),
  setTag: vi.fn(),
  captureException: vi.fn(),
  withErrorBoundary: vi.fn((component: unknown) => component),
}));

type CapturedBrowserOptions = {
  dsn?: string;
  environment?: string;
  release?: string;
  integrations?: unknown[];
  tracesSampleRate?: number;
  replaysSessionSampleRate?: number;
  replaysOnErrorSampleRate?: number;
  beforeSend?: (event: {
    request?: { data?: unknown };
    extra?: Record<string, unknown>;
    breadcrumbs?: Array<{ data?: Record<string, unknown> }>;
  }) => unknown;
};

function latestInitOptions(): CapturedBrowserOptions {
  const options = vi.mocked(Sentry.init).mock.calls.at(-1)?.[0] as CapturedBrowserOptions | undefined;
  expect(options).toBeTruthy();
  return options!;
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('web Sentry integration', () => {
  it('does not initialize Sentry when the DSN is absent', () => {
    vi.stubEnv('VITE_SENTRY_DSN', '');

    initSentry();

    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('initializes with privacy-safe defaults and no session replay by default', () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.ingest.sentry.io/1');
    vi.stubEnv('VITE_SENTRY_ENVIRONMENT', 'staging');
    vi.stubEnv('VITE_SENTRY_RELEASE', 'bidstack-web@0.1.0+abc123');
    vi.stubEnv('VITE_SENTRY_TRACES_SAMPLE_RATE', '0.25');
    vi.stubEnv('VITE_SENTRY_REPLAY', 'false');

    initSentry();

    const options = latestInitOptions();
    expect(options.dsn).toBe('https://public@example.ingest.sentry.io/1');
    expect(options.environment).toBe('staging');
    expect(options.release).toBe('bidstack-web@0.1.0+abc123');
    expect(options.tracesSampleRate).toBe(0.25);
    expect(options.replaysSessionSampleRate).toBe(0);
    expect(options.replaysOnErrorSampleRate).toBe(0);
    expect(Sentry.browserTracingIntegration).toHaveBeenCalledTimes(1);
    expect(Sentry.replayIntegration).not.toHaveBeenCalled();
    expect(options.beforeSend).toEqual(expect.any(Function));
  });

  it('opts into replay only when explicitly enabled and masks inputs', () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.ingest.sentry.io/1');
    vi.stubEnv('VITE_SENTRY_REPLAY', 'true');

    initSentry();

    const options = latestInitOptions();
    expect(Sentry.replayIntegration).toHaveBeenCalledWith({
      maskAllInputs: true,
      maskAllText: false,
      blockAllMedia: false,
    });
    expect(options.replaysSessionSampleRate).toBe(0);
    expect(options.replaysOnErrorSampleRate).toBe(1);
  });

  it('scrubs request, extra, and breadcrumb PII before sending browser events', () => {
    const event = {
      request: {
        data: {
          email: 'tony@example.com',
          safeField: 'pipeline',
          nested: { token: 'secret-token', amount: 42 },
        },
      },
      extra: {
        phoneNumber: '+1-555-0100',
        nested: { apiKey: 'provider-secret', source: 'browser' },
      },
      breadcrumbs: [
        {
          category: 'ui.click',
          data: { name: 'Tony', label: 'Save' },
        },
      ],
    };

    const scrubbed = scrubSentryBrowserEvent(event);

    expect(scrubbed.request.data).toEqual({
      email: '[REDACTED]',
      safeField: 'pipeline',
      nested: { token: '[REDACTED]', amount: 42 },
    });
    expect(scrubbed.extra).toEqual({
      phoneNumber: '[REDACTED]',
      nested: { apiKey: '[REDACTED]', source: 'browser' },
    });
    expect(scrubbed.breadcrumbs[0]?.data).toEqual({
      name: '[REDACTED]',
      label: 'Save',
    });
  });

  it('stores only pseudonymous user context', () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.ingest.sentry.io/1');

    setSentryUser({ id: 'user-123', orgId: 'org-456' });

    expect(Sentry.setUser).toHaveBeenCalledWith({ id: 'user-123' });
    expect(Sentry.setTag).toHaveBeenCalledWith('orgId', 'org-456');
    expect(JSON.stringify(vi.mocked(Sentry.setUser).mock.calls)).not.toContain('@');
    expect(JSON.stringify(vi.mocked(Sentry.setUser).mock.calls)).not.toContain('email');
  });

  it('clears stale browser tenant tags on logout', () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.ingest.sentry.io/1');

    setSentryUser({ id: 'user-123', orgId: 'org-456' });
    setSentryUser(null);

    expect(Sentry.setUser).toHaveBeenLastCalledWith(null);
    expect(Sentry.setTag).toHaveBeenLastCalledWith('orgId', SENTRY_UNAUTHENTICATED_ORG_TAG);
  });
});
