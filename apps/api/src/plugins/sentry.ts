/**
 * Sentry Node SDK plugin for Fastify.
 *
 * PII scrubbing:
 * BidStack handles personal data. We must not send names, emails, phone
 * numbers, tokens, or raw request bodies to Sentry without field-name
 * redaction. The beforeSend hook strips these fields before transmission.
 *
 * User context:
 * Sentry user context is intentionally pseudonymous: { id: userId } only.
 * Email, name, and phone stay out of Sentry scopes.
 */

import * as Sentry from '@sentry/node';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { isExpectedClientAbortError } from '../lib/http-client-abort.js';
import { scrubSentryEvent } from '../lib/sentry-privacy.js';

export const SENTRY_UNAUTHENTICATED_ORG_TAG = 'unauthenticated';

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    sendDefaultPii: false,
    beforeSend: scrubSentryEvent,
    ignoreErrors: ['ResizeObserver loop limit exceeded', 'Non-Error exception captured'],
  });
}

export function applySentryAuthScope(auth: { userId?: string; orgId?: string }): void {
  if (auth.userId) {
    Sentry.setUser({ id: auth.userId });
  } else {
    Sentry.setUser(null);
  }
  Sentry.setTag('orgId', auth.orgId ?? SENTRY_UNAUTHENTICATED_ORG_TAG);
}

export function clearSentryAuthScope(): void {
  Sentry.setUser(null);
  Sentry.setTag('orgId', SENTRY_UNAUTHENTICATED_ORG_TAG);
}

export function captureSentryServerError(error: unknown): void {
  if (!process.env.SENTRY_DSN) return;
  if (isExpectedClientAbortError(error)) return;
  Sentry.captureException(error);
}

/**
 * Fastify plugin that:
 * 1. Adds pseudonymous user/org context to the active request scope.
 * 2. Clears user context after each response as a belt-and-suspenders guard.
 *
 * 5xx capture lives in the central error handler so handled application errors
 * are reported exactly where the response is normalized.
 */
export const sentryPlugin: FastifyPluginAsync = fp(async (fastify) => {
  if (!process.env.SENTRY_DSN) return;

  fastify.addHook('onRequest', async (req: FastifyRequest) => {
    const auth = (req as unknown as { auth?: { userId?: string; orgId?: string } }).auth;
    applySentryAuthScope(auth ?? {});
  });

  fastify.addHook('onResponse', async () => {
    clearSentryAuthScope();
  });
});
