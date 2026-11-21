// Centralized error handler. Maps Zod validation, Prisma known errors, and
// thrown HTTP errors into structured RFC-7807-ish JSON.

import { Prisma } from '@bidstack/db';
import type { FastifyError, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';

import { DELIBERATE_503, isDeliberate503 } from '@bidstack/shared/server-crypto';

import { isProviderTimeoutError } from '../lib/fetch-timeout.js';
import { clientAbortLogFields, isExpectedClientAbortError } from '../lib/http-client-abort.js';
import { isOAuthRefreshLockError } from '../lib/oauth-refresh-lock.js';
import { captureSentryServerError } from './sentry.js';

function isFrameworkValidation(err: FastifyError): boolean {
  if (err.code === 'FST_ERR_VALIDATION') return true;
  return Array.isArray(err.validation);
}

function isFrameworkPayloadTooLarge(err: FastifyError): boolean {
  return err.code === 'FST_ERR_CTP_BODY_TOO_LARGE';
}

function stampDeliberate503(err: unknown): void {
  if (typeof err === 'object' && err !== null) {
    Object.defineProperty(err, DELIBERATE_503, { value: true });
  }
}

/** Drop cause before a log or Sentry capture. Pino appends cause to the message. */
function withoutCause(err: unknown): unknown {
  if (!(err instanceof Error)) return err;
  const copy = new Error(err.message);
  copy.name = err.name;
  copy.stack = err.stack;
  return copy;
}

const plugin: FastifyPluginAsync = fp(async (server) => {
  // Sensible decorates every server with one shared httpErrors object. Replacing
  // a method on it would stamp errors built on other servers too. This server
  // gets its own object whose serviceUnavailable carries the brand.
  const shared = server.httpErrors;
  if (shared?.serviceUnavailable) {
    const original = shared.serviceUnavailable.bind(shared);
    const wrapped = Object.assign(Object.create(shared), {
      serviceUnavailable: (...args: unknown[]) => {
        const err = original(...(args as []));
        stampDeliberate503(err);
        return err;
      },
    });
    Object.defineProperty(server, 'httpErrors', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: wrapped,
    });
  }

  server.setErrorHandler((err: FastifyError, req, reply) => {
    if (isExpectedClientAbortError(err, req.raw)) {
      req.log.info(
        { ...clientAbortLogFields(err), method: req.method, url: req.url },
        'client aborted request',
      );
      if (reply.sent || reply.raw.destroyed || reply.raw.writableEnded) return;
      return reply.status(499).send({
        statusCode: 499,
        error: 'Client Closed Request',
        message: 'The client closed the request before the response completed.',
      });
    }

    if (err instanceof ZodError || isFrameworkValidation(err)) {
      // The compiler message is "body/name Required" / "Expected array, received
      // string". Log the detail; the client only gets a stable code.
      req.log.warn(
        {
          issues: err instanceof ZodError ? err.issues : err.validation,
        },
        'validation failed',
      );
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        code: 'validation',
        message: 'Validation failed',
      });
    }

    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') {
        return reply.status(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: 'A record with this unique value already exists.',
        });
      }
      if (err.code === 'P2025') {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'The requested record was not found.',
        });
      }
      if (err.code === 'P2003') {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Foreign key constraint failed.',
        });
      }
      // Log unmapped Prisma errors with their code for observability.
      req.log.error({ err, prismaCode: err.code }, 'unhandled Prisma error');
    }

    if (err instanceof Prisma.PrismaClientValidationError) {
      req.log.warn({ err }, 'Prisma validation error');
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Database query validation failed.',
      });
    }

    if (isProviderTimeoutError(err)) {
      req.log.warn(
        {
          provider: err.provider,
          operation: err.operation,
          timeoutMs: err.timeoutMs,
        },
        'provider request timed out',
      );
      return reply.status(504).send({
        statusCode: 504,
        error: 'Gateway Timeout',
        message: err.message,
      });
    }

    if (isOAuthRefreshLockError(err)) {
      req.log.warn({ code: err.code }, 'OAuth refresh lock unavailable');
      return reply.status(503).send({
        statusCode: 503,
        error: 'Service Unavailable',
        message: err.message,
      });
    }

    if (isDeliberate503(err)) {
      // WHY: httpErrors.serviceUnavailable and a missing integration token key
      // are deliberate. Their messages are written by our code. Masking them
      // as a generic 500 hides a condition the caller can act on.
      return reply.status(503).send({
        statusCode: 503,
        error: 'Service Unavailable',
        message: err.message,
      });
    }

    if (isFrameworkPayloadTooLarge(err)) {
      return reply.status(413).send({
        statusCode: 413,
        error: 'Payload Too Large',
        code: 'payload_too_large',
        message: 'That upload is too large.',
      });
    }

    if (err.statusCode && err.statusCode < 500) {
      // WHY: 4xx errors are application-generated (route handlers, httpErrors.*).
      // Framework schema failures and the default body-limit error are handled
      // above. What remains was written by our own code and is safe to return
      // verbatim (e.g. "Unknown permissionId(s): ...").
      return reply.status(err.statusCode).send({
        statusCode: err.statusCode,
        error: err.name,
        message: err.message,
      });
    }

    const logged = withoutCause(err);
    req.log.error({ err: logged }, 'unhandled error');
    captureSentryServerError(logged);
    return reply.status(500).send({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Something went wrong',
    });
  });
});

export const errorHandlerPlugin = plugin;
