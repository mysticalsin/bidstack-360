/**
 * Sentry Node SDK plugin for Fastify.
 *
 * WHY Sentry first in plugin registration order:
 * Sentry captures uncaught errors and unhandled rejections. If it were
 * registered after other plugins, errors thrown during plugin init (e.g. DB
 * connection, Redis) would not be captured. Register this before any other
 * plugin in buildServer().
 *
 * PII scrubbing (beforeSend):
 * BidStack handles personal data. We must not send names, emails, or phone
 * numbers to Sentry's servers. The beforeSend hook strips these fields from
 * request bodies and extra context before the event is transmitted.
 *
 * User context:
 * We set Sentry user to { id: userId, orgId } only — no email, no name.
 * This satisfies GDPR data minimization while still enabling per-user error
 * correlation in Sentry.
 *
 * Sourcemaps:
 * Upload via sentry-cli in CI (see docs/observability/sentry.md).
 * SENTRY_RELEASE should be set to the git SHA or semver at build time.
 */

import * as Sentry from '@sentry/node';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

// ─── PII field names to scrub ─────────────────────────────────────────────

const PII_FIELDS = new Set([
  'email', 'phone', 'phoneNumber', 'phone_number',
  'name', 'firstName', 'lastName', 'first_name', 'last_name',
  'fullName', 'full_name', 'displayName', 'display_name',
  'address', 'street', 'city', 'zipCode', 'zip_code', 'postalCode', 'postal_code',
  'ssn', 'taxId', 'tax_id', 'nationalId', 'national_id',
  'password', 'secret', 'token', 'apiKey', 'api_key',
]);

/**
 * Recursively scrub PII fields from an object by replacing values with [REDACTED].
 * WHY recursive: request bodies can be arbitrarily nested (e.g., contact inside opportunity).
 */
function scrubPii(obj: unknown, depth = 0): unknown {
  if (depth > 10 || obj === null || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => scrubPii(item, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    result[key] = PII_FIELDS.has(key) ? '[REDACTED]' : scrubPii(value, depth + 1);
  }
  return result;
}

// ─── Sentry init ──────────────────────────────────────────────────────────

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return; // Sentry is opt-in — skip if no DSN configured

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE,
    // WHY 0.1 in production: captures 10% of transactions for performance monitoring
    // without excessive volume cost. Set SENTRY_TRACES_SAMPLE_RATE to override.
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),

    beforeSend(event) {
      // Scrub request body
      if (event.request?.data) {
        event.request.data = scrubPii(event.request.data);
      }
      // Scrub extra context
      if (event.extra) {
        event.extra = scrubPii(event.extra) as Record<string, unknown>;
      }
      return event;
    },

    // WHY ignoreErrors: these are not actionable — they're client network
    // issues or browser extension noise.
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'Non-Error exception captured',
    ],
  });
}

// ─── Fastify plugin ───────────────────────────────────────────────────────

/**
 * Fastify plugin that:
 *  1. Sets Sentry user context on each request (id + orgId, no PII).
 *  2. Adds orgId tag for filtering in Sentry.
 *  3. Reports unhandled errors to Sentry before the error-handler normalizes them.
 */
export const sentryPlugin: FastifyPluginAsync = async (fastify) => {
  if (!process.env.SENTRY_DSN) return;

  // Set user context + tags from auth on every authenticated request
  fastify.addHook('onRequest', async (req: FastifyRequest) => {
    const auth = (req as unknown as { auth?: { userId?: string; orgId?: string } }).auth;
    if (auth?.userId) {
      Sentry.setUser({ id: auth.userId });
    }
    if (auth?.orgId) {
      Sentry.setTag('orgId', auth.orgId);
    }
  });

  // Capture errors before the error handler serializes them
  fastify.addHook('onError', async (_req: FastifyRequest, _reply, error) => {
    // WHY 500+ only: 4xx errors are client mistakes, not bugs. Only server
    // errors warrant Sentry capture to avoid alert noise.
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    if (statusCode >= 500) {
      Sentry.captureException(error);
    }
  });

  // Clear user context after each request to prevent cross-request leakage
  fastify.addHook('onResponse', async () => {
    Sentry.setUser(null);
  });
};
