import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  const environment = process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development';
  const isDev = environment === 'development';

  Sentry.init({
    dsn,
    environment,
    release: process.env.npm_package_version,
    tracesSampleRate: isDev ? 1.0 : 0.1,
    profilesSampleRate: 0.1,
    integrations: [nodeProfilingIntegration()],
  });
}

export async function shutdownSentry(): Promise<void> {
  await Sentry.close(2000);
}
