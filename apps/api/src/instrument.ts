import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

import { scrubSentryEvent } from './lib/sentry-privacy.js';

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  const environment = process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development';
  const isDev = environment === 'development';

  Sentry.init({
    dsn,
    environment,
    release: process.env.SENTRY_RELEASE ?? process.env.npm_package_version,
    sendDefaultPii: false,
    tracesSampleRate: isDev ? 1.0 : 0.1,
    profilesSampleRate: 0.1,
    integrations: [nodeProfilingIntegration()],
    beforeSend: scrubSentryEvent,
  });
}

export async function shutdownSentry(): Promise<void> {
  await Sentry.close(2000);
}
