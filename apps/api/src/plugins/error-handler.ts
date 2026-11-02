// Centralized error handler. Maps Zod validation, Prisma known errors, and
// thrown HTTP errors into structured RFC-7807-ish JSON.

import { Prisma } from '@bidstack/db';
import type { FastifyError, FastifyPluginAsync, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';

import { isProviderTimeoutError } from '../lib/fetch-timeout.js';
import { clientAbortLogFields, isExpectedClientAbortError } from '../lib/http-client-abort.js';
import { isOAuthRefreshLockError } from '../lib/oauth-refresh-lock.js';
import { captureSentryServerError } from './sentry.js';

function jsonText(body: unknown): string {
  try {
    const text = JSON.stringify(body);
    if (typeof text === 'string') return text;
  } catch {
    // A BigInt or circular cause must not turn the error response into plain text.
  }
  return '{"statusCode":500,"error":"Internal Server Error","message":"Something went wrong"}';
}

function sendJson(reply: FastifyReply, status: number, body: unknown) {
  // Send an already-encoded JSON string. Running the route schema again on an
  // error body used to throw, and Fastify then wrote plain text. The agreements
  // card surfaces that as "Invalid JSON response from server".
  const text = jsonText(body);
  return reply
    .status(status)
    .type('application/json; charset=utf-8')
    .serializer((payload) => (typeof payload === 'string' ? payload : text))
    .send(text);
}

const plugin: FastifyPluginAsync = fp(async (server) => {
  server.setErrorHandler((err: FastifyError, req, reply) => {
    if (isExpectedClientAbortError(err, req.raw)) {
      req.log.info(
        { ...clientAbortLogFields(err), method: req.method, url: req.url },
        'client aborted request',
      );
      if (reply.sent || reply.raw.destroyed || reply.raw.writableEnded) return;
      return sendJson(reply, 499, {
        statusCode: 499,
        error: 'Client Closed Request',
        message: 'The client closed the request before the response completed.',
      });
    }

    if (err instanceof ZodError) {
      req.log.warn({ issues: err.issues }, 'validation failed');
      return sendJson(reply, 400, {
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        issues: err.issues,
      });
    }

    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') {
        return sendJson(reply, 409, {
          statusCode: 409,
          error: 'Conflict',
          message: 'A record with this unique value already exists.',
        });
      }
      if (err.code === 'P2025') {
        return sendJson(reply, 404, {
          statusCode: 404,
          error: 'Not Found',
          message: 'The requested record was not found.',
        });
      }
      if (err.code === 'P2003') {
        return sendJson(reply, 400, {
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
      return sendJson(reply, 400, {
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
      return sendJson(reply, 504, {
        statusCode: 504,
        error: 'Gateway Timeout',
        message: err.message,
      });
    }

    if (isOAuthRefreshLockError(err)) {
      req.log.warn({ code: err.code }, 'OAuth refresh lock unavailable');
      return sendJson(reply, 503, {
        statusCode: 503,
        error: 'Service Unavailable',
        message: err.message,
      });
    }

    if (err.statusCode && err.statusCode < 500) {
      // WHY: 4xx errors are application-generated (route handlers, httpErrors.*).
      // Unlike 5xx errors — which may contain DB connection strings, stack traces,
      // or ORM internals — 4xx messages are always crafted by our own code and are
      // safe to return verbatim. Exposing them gives API callers actionable feedback
      // (e.g. "Unknown permissionId(s): ...") without leaking internals.
      return sendJson(reply, err.statusCode, {
        statusCode: err.statusCode,
        error: err.name,
        message: err.message,
      });
    }

    req.log.error({ err }, 'unhandled error');
    captureSentryServerError(err);
    return sendJson(reply, 500, {
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Something went wrong',
    });
  });
});

export const errorHandlerPlugin = plugin;
