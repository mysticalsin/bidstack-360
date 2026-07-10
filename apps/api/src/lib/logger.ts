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

import { scrubPii, scrubTelemetryValue, scrubUrl } from './sentry-privacy.js';

export interface LoggerOptions {
  name?: string;
  level?: string;
}

let devPrettyTransport: ReturnType<typeof pino.transport> | undefined;

function getDevPrettyTransport(): ReturnType<typeof pino.transport> | undefined {
  if (process.env.NODE_ENV !== 'development') return undefined;

  devPrettyTransport ??= pino.transport({
    target: 'pino-pretty',
    options: { colorize: true, singleLine: true },
  });

  return devPrettyTransport;
}

// pino's own `req`/`res`/`err` serializers (privacyLogSerializers below)
// already extract the fields they need and scrub the resulting plain
// object. If we deep-scrub the *live* req/res/err values here, we run
// before serialization: Error.message/stack are non-enumerable so scrubbing
// the raw Error strips them (emitting `err: {}`), Fastify's req/res getters
// (method/url/statusCode) live on the prototype so they're lost the same
// way, and walking the raw req can chase req -> socket -> server for every
// log line. So the merging object's req/res/err keys (and a bare Error
// passed directly, which pino wraps into `{ err }` itself) are passed
// through untouched; every other field is scrubbed here as before.
const SERIALIZED_LOG_KEYS = new Set(['req', 'res', 'err']);

function scrubLogMergingObject(value: unknown): unknown {
  if (value instanceof Error) return value;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return scrubTelemetryValue(value);
  }
  const result: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(value as Record<string, unknown>)) {
    result[key] = SERIALIZED_LOG_KEYS.has(key) ? fieldValue : scrubTelemetryValue(fieldValue, key, 1);
  }
  return result;
}

export function scrubLogMethodArgs(args: Parameters<pino.LogFn>): Parameters<pino.LogFn> {
  return args.map((arg, index) =>
    index === 0 ? scrubLogMergingObject(arg) : scrubTelemetryValue(arg),
  ) as Parameters<pino.LogFn>;
}

export const privacyLogSerializers: pino.LoggerOptions['serializers'] = {
  req(req: {
    id?: string;
    method?: string;
    url?: string;
    headers?: Record<string, unknown>;
    remoteAddress?: string;
    remotePort?: number;
  }) {
    return scrubPii({
      id: req.id,
      method: req.method,
      url: req.url ? scrubUrl(req.url) : undefined,
      headers: req.headers,
      remoteAddress: req.remoteAddress,
      remotePort: req.remotePort,
    });
  },
  res(res: { statusCode?: number }) {
    return {
      statusCode: res.statusCode,
    };
  },
  err(err: unknown) {
    return scrubPii(err instanceof Error ? pino.stdSerializers.err(err) : err);
  },
};

export const privacyLogHooks: pino.LoggerOptions['hooks'] = {
  logMethod(args, method) {
    method.apply(this, scrubLogMethodArgs(args));
  },
};

export function createLogger(options: LoggerOptions = {}): pino.Logger {
  const loggerOptions: pino.LoggerOptions = {
    name: options.name ?? 'bidstack',
    level: options.level ?? process.env.LOG_LEVEL ?? 'info',

    // Standard fields that Datadog's log pipeline automatically parses
    // (source, service, env are indexed as facets)
    base: {
      service: process.env.DD_SERVICE ?? 'bidstack-api',
      env: process.env.DD_ENV ?? process.env.NODE_ENV ?? 'development',
    },

    serializers: privacyLogSerializers,
    hooks: privacyLogHooks,

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

    // WHY timestamp: Datadog log pipeline uses the timestamp field for log ordering.
    // pino's default `time` field is already ISO 8601 which Datadog parses correctly.
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  const transport = getDevPrettyTransport();
  return transport ? pino(loggerOptions, transport) : pino(loggerOptions);
}

/**
 * Default application logger. Fastify creates child loggers from its own
 * logger instance (set in Fastify options in server.ts); this export is for
 * non-request contexts.
 */
export const log = createLogger({ name: 'bidstack-api' });
