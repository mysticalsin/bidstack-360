# Observability Audit Findings
**Date:** 2026-05-25
**Scope:** Observability, logging, error handling (`pino` logging, request-scoped loggers, error serialization, `console.log` usage).

## Summary
The codebase has been audited for compliance with observability standards, specifically focusing on `pino` logging, Datadog correlation, and correct request scoping. Overall, `console.log` is successfully banished from the shipped application, and error serialization remains robust.

However, several background services and queues bypass the standard `logger.ts` factory, which breaks the Datadog trace correlation and Fastify environment-aware formatting.

### 1. Hardcoded Pino Instances (Bypassing `logger.ts`)
The `apps/api/src/lib/logger.ts` file was introduced to properly configure Pino with Datadog trace correlation (`dd-trace`) and pretty-printing. However, several files are still importing `pino` directly and instantiating their own root loggers. This breaks log correlation.

**Affected Files:**
- `apps/api/src/lib/dust-push.ts`
- `apps/api/src/queues/company-enrich-apollo.ts`
- `apps/api/src/queues/document-extract.ts`
- `apps/api/src/queues/dust-poll.ts`
- `apps/api/src/queues/webhook-delivery.ts`
- `apps/api/src/services/ai/dust-agent.service.ts`
- `apps/api/src/services/predictive-scoring.service.ts`

**Fix Recommendation:**
Either import the shared `log` from `../lib/logger.js`, use `createLogger({ name: '...' })`, or better yet, pass the request-scoped logger (`req.log`) down from the Fastify route handlers when these functions are invoked during an HTTP request.

### 2. Request Context Propagation
For queue producers (e.g., `enqueueDocumentExtract`, `enqueueApolloEnrich`), they are invoked from within Fastify route handlers. Currently, they use their own static loggers, meaning log lines like `"Document extract job enqueued"` lack the `X-Request-Id` and Datadog trace context of the HTTP request that triggered them.
**Fix Recommendation:** Update the enqueue functions to accept a `logger: pino.Logger` parameter and pass `req.log` to them.

### 3. Error Context (`cause`)
The rule from `MISTAKES.md` regarding `throw new Error(..., { cause: err })` is correctly respected. Places that throw domain errors after catching an exception (e.g., `apps/api/src/services/agents/agents.service.ts:237`) correctly append `{ cause: err }`.

### 4. Console Usage
- No `console.log` or `console.error` instances exist in the production API or Worker code.
- Known legitimate uses exist in `docs/` scripts and `scratch` files, which are perfectly acceptable.

## Conclusion
Score: 9.0/10. The codebase handles errors and logging well but needs to finalize the migration to the new `logger.ts` factory across all background services and queue producers.
