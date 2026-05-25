/**
 * Sentry React SDK initialization.
 *
 * Load order: call initSentry() before React renders (in main.tsx, before
 * createRoot). This ensures the Sentry error boundary and global handlers are
 * active from the first render.
 *
 * PII scrubbing (beforeSend):
 * The CRM web app can hold PII in route params (e.g. /contacts/:id) and
 * form state. We strip common PII fields from breadcrumbs and extras before
 * transmission. NOTE: Sentry's SDK already hashes email-looking strings in
 * stack frames by default; this is an additional layer.
 *
 * Session Replay:
 * Opt-in via VITE_SENTRY_REPLAY=true. When enabled, Sentry captures a video
 * replay of user sessions around errors. All input fields are masked by
 * default (Sentry's maskAllInputs=true). Only enable in production with legal
 * sign-off — session replay captures user behavior.
 *
 * Performance:
 * BrowserTracing instruments React Router v6 navigation and XHR/fetch calls.
 * Useful for detecting slow page loads and API calls in field.
 */

import * as Sentry from '@sentry/react';

// ─── PII field scrubber ────────────────────────────────────────────────────

const PII_FIELDS = new Set([
  'email', 'phone', 'phoneNumber', 'phone_number',
  'name', 'firstName', 'lastName', 'first_name', 'last_name',
  'password', 'secret', 'token', 'apiKey', 'api_key',
]);

function scrubPii(obj: unknown, depth = 0): unknown {
  if (depth > 8 || obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((item) => scrubPii(item, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    result[key] = PII_FIELDS.has(key) ? '[REDACTED]' : scrubPii(value, depth + 1);
  }
  return result;
}

// ─── Init ─────────────────────────────────────────────────────────────────

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return; // Sentry is opt-in

  const integrations: Sentry.BrowserOptions['integrations'] = [
    Sentry.browserTracingIntegration(),
  ];

  // Session Replay — opt-in via env var
  if (import.meta.env.VITE_SENTRY_REPLAY === 'true') {
    integrations.push(
      Sentry.replayIntegration({
        maskAllInputs: true,  // WHY: inputs can contain PII; mask by default
        maskAllText: false,   // UI text is generally not PII; keep for UX debugging
        blockAllMedia: false,
      }),
    );
  }

  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE,
    integrations,

    // 10% of page loads get performance tracing. Adjust with VITE_SENTRY_TRACES_SAMPLE_RATE.
    tracesSampleRate: parseFloat(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),

    // Replay: only capture replays for sessions where an error occurs.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: import.meta.env.VITE_SENTRY_REPLAY === 'true' ? 1.0 : 0,

    beforeSend(event) {
      // Scrub request body and extra context
      if (event.request?.data) {
        event.request.data = scrubPii(event.request.data);
      }
      if (event.extra) {
        event.extra = scrubPii(event.extra) as Record<string, unknown>;
      }
      // Strip PII from breadcrumb data
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((bc) => ({
          ...bc,
          data: bc.data ? (scrubPii(bc.data) as typeof bc.data) : bc.data,
        }));
      }
      return event;
    },

    // WHY: filter common browser/extension noise from Sentry inbox
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      'Non-Error exception captured',
      /^Loading chunk \d+ failed/,
      /^Failed to fetch dynamically imported module/,
    ],
  });
}

// ─── Re-exports for convenience ────────────────────────────────────────────

export { Sentry };

/**
 * Wrap a React component with Sentry's ErrorBoundary.
 * Usage: export default withSentryErrorBoundary(MyPage, { fallback: <ErrorFallback /> })
 */
export const withSentryErrorBoundary = Sentry.withErrorBoundary;

/**
 * Set the authenticated user context in Sentry.
 * Call this after login completes. Pass null on logout.
 * WHY id-only: we must not send email/name to Sentry (PII/GDPR).
 */
export function setSentryUser(user: { id: string; orgId: string } | null): void {
  if (!import.meta.env.VITE_SENTRY_DSN) return;
  Sentry.setUser(user ? { id: user.id } : null);
  if (user?.orgId) Sentry.setTag('orgId', user.orgId);
}
