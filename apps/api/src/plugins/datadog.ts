/**
 * Datadog APM plugin for Fastify.
 *
 * WHY dd-trace must be initialized BEFORE any other require/import:
 * Datadog's tracer patches Node.js built-in modules at load time. If loaded
 * after other modules, instrumentation is incomplete. This file is imported
 * first in apps/api/src/index.ts BEFORE the Fastify server is built.
 *
 * WHY Sentry first, Datadog second (plugin registration order):
 * Sentry catches errors; Datadog traces performance. Sentry's error capture
 * hooks run at request level and must be in place before Datadog's request
 * spans start. Both are registered before route handlers.
 *
 * Custom metrics emitted:
 *  bidstack.api.requests.total    — tagged: method, route, status
 *  bidstack.api.latency           — histogram in ms, same tags
 *  bidstack.integrations.calls    — tagged: provider (twilio, gmail, slack, etc.)
 *
 * DD_API_KEY is never logged. The tracer reads it from the environment directly.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';

// ─── dd-trace init ─────────────────────────────────────────────────────────

let tracerInitialized = false;

/**
 * Initialize dd-trace. Must be called before any other module is loaded.
 * Safe to call multiple times (no-op after first call).
 *
 * WHY conditional: tests and local dev without a Datadog agent should not
 * fail. DD_API_KEY absence is the signal that Datadog is not configured.
 */
export function initDatadog(): void {
  if (tracerInitialized) return;
  tracerInitialized = true;

  const apiKey = process.env.DD_API_KEY;
  if (!apiKey) {
    // Datadog is opt-in — skip initialization silently
    return;
  }

  // WHY dynamic require: dd-trace MUST be loaded before any other module.
  // A static import at module top would not give us control over load order.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const tracer = require('dd-trace');
  tracer.init({
    service: process.env.DD_SERVICE ?? 'bidstack-api',
    env: process.env.DD_ENV ?? process.env.NODE_ENV ?? 'development',
    version: process.env.DD_VERSION ?? process.env.SENTRY_RELEASE,
    logInjection: true,  // WHY: injects trace.id + span.id into Pino log lines
    runtimeMetrics: true, // WHY: exposes GC, event loop lag, heap stats to Datadog
    profiling: process.env.DD_PROFILING_ENABLED === 'true',
    // Prisma instrumentation — auto-detects pg driver
    // Fastify is auto-instrumented via the http plugin
    plugins: true,
  });
}

// ─── Fastify plugin ────────────────────────────────────────────────────────

/**
 * Fastify plugin that emits custom Datadog StatsD metrics on every request.
 *
 * WHY custom metrics instead of relying on auto-instrumentation only:
 * Auto-instrumentation gives us generic http.request spans. Custom metrics
 * let us track BidStack-specific SLIs: per-route latency, error rates per
 * integration provider, and worker queue depth.
 */
export const datadogPlugin: FastifyPluginAsync = async (fastify) => {
  const apiKey = process.env.DD_API_KEY;
  if (!apiKey) return; // No-op if Datadog not configured

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const tracer = require('dd-trace');

  fastify.addHook('onRequest', async (req: FastifyRequest) => {
    // Store request start time for latency calculation in onResponse
    (req as unknown as { _ddStartTime: number })._ddStartTime = Date.now();
  });

  fastify.addHook('onResponse', async (req: FastifyRequest, reply: FastifyReply) => {
    const startTime = (req as unknown as { _ddStartTime?: number })._ddStartTime;
    if (!startTime) return;

    const latencyMs = Date.now() - startTime;
    const routePattern = req.routeOptions?.url ?? req.url ?? 'unknown';
    const method = req.method;
    const status = reply.statusCode;
    const tags = [`method:${method}`, `route:${routePattern}`, `status:${status}`];

    tracer.dogstatsd?.increment('bidstack.api.requests.total', 1, tags);
    tracer.dogstatsd?.histogram('bidstack.api.latency', latencyMs, tags);
  });
};

// ─── Integration call metric helper ───────────────────────────────────────

/**
 * Emit a metric for an external integration API call.
 * Call this in service files after each provider request.
 *
 * @param provider - e.g. 'twilio', 'gmail', 'slack', 'microsoft_graph'
 * @param success  - whether the call succeeded
 */
export function trackIntegrationCall(provider: string, success: boolean): void {
  if (!process.env.DD_API_KEY) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tracer = require('dd-trace');
    const tags = [`provider:${provider}`, `success:${success}`];
    tracer.dogstatsd?.increment('bidstack.integrations.calls', 1, tags);
  } catch {
    // Silently ignore — metrics are best-effort; never fail the main path
  }
}
