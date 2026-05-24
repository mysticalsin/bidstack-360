/**
 * Pino logger factory with Datadog trace correlation.
 *
 * WHY a factory instead of a singleton:
 * Fastify creates a child logger per request with req/res metadata already
 * bound. We export a factory that creates a base logger for non-request
 * contexts (workers, scripts, standalone services).
 *
 * Datadog log correlation:
 * When dd-trace logInjection is enabled, dd-trace patches the Pino instance
 * to inject dd.trace_id, dd.span_id, and dd.service on every log line.
 * This links logs to Datadog APM traces in the Datadog UI.
 *
 * WHY we don't use the Datadog Pino formatter directly:
 * The Datadog formatter changes the log format significantly and breaks
 * pino-pretty in development. Instead, we rely on dd-trace's logInjection
 * which only adds the correlation fields, keeping the format compatible
 * with both pino-pretty (dev) and the Datadog log pipeline (production).
 *
 * Correlation IDs:
 * Every log line includes request.id (set by Fastify's genReqId) which is
 * also the X-Request-Id header. This creates a chain:
 *   client → X-Request-Id → Fastify → Pino → Datadog → APM trace
 */

import pino from 'pino';

export interface LoggerOptions {
  name?: string;
  level?: string;
}

export function createLogger(options: LoggerOptions = {}): pino.Logger {
  const isDev = process.env.NODE_ENV === 'development';

  return pino({
    name: options.name ?? 'bidstack',
    level: options.level ?? process.env.LOG_LEVEL ?? 'info',

    // Standard fields that Datadog's log pipeline automatically parses
    // (source, service, env are indexed as facets)
    base: {
      service: process.env.DD_SERVICE ?? 'bidstack-api',
      env: process.env.DD_ENV ?? process.env.NODE_ENV ?? 'development',
    },

    // WHY redact: prevent accidental PII/secrets in log output.
    // These paths cover the most common sources of credential leakage.
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        'req.headers["x-twilio-signature"]',
        '*.password',
        '*.secret',
        '*.token',
        '*.apiKey',
        '*.api_key',
        '*.authToken',
        '*.auth_token',
        '*.accessToken',
        '*.access_token',
        '*.refreshToken',
        '*.refresh_token',
        'err.config.headers.Authorization',
        'err.config.headers.authorization',
      ],
      remove: true,
    },

    transport: isDev
      ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
      : undefined,

    // WHY timestamp: Datadog log pipeline uses the timestamp field for log ordering.
    // pino's default `time` field is already ISO 8601 which Datadog parses correctly.
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

/**
 * Default application logger. Fastify creates child loggers from its own
 * logger instance (set in Fastify options in server.ts); this export is for
 * non-request contexts.
 */
export const log = createLogger({ name: 'bidstack-api' });
