// Centralized error handler. Maps Zod validation, Prisma known errors, and
// thrown HTTP errors into structured RFC-7807-ish JSON.

import { Prisma } from '@bidstack/db';
import type { FastifyError, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';

import { isProviderTimeoutError } from '../lib/fetch-timeout.js';
import { clientAbortLogFields, isExpectedClientAbortError } from '../lib/http-client-abort.js';
import { isOAuthRefreshLockError } from '../lib/oauth-refresh-lock.js';
import { captureSentryServerError } from './sentry.js';

const plugin: FastifyPluginAsync = fp(async (server) => {
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

    if (err instanceof ZodError) {
      req.log.warn({ issues: err.issues }, 'validation failed');
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        issues: err.issues,
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

    if (err.statusCode && err.statusCode < 500) {
      // WHY: 4xx errors are application-generated (route handlers, httpErrors.*).
      // Unlike 5xx errors — which may contain DB connection strings, stack traces,
      // or ORM internals — 4xx messages are always crafted by our own code and are
      // safe to return verbatim. Exposing them gives API callers actionable feedback
      // (e.g. "Unknown permissionId(s): ...") without leaking internals.
      return reply.status(err.statusCode).send({
        statusCode: err.statusCode,
        error: err.name,
        message: err.message,
      });
    }

    req.log.error({ err }, 'unhandled error');
    captureSentryServerError(err);
    return reply.status(500).send({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Something went wrong',
    });
  });
});

export const errorHandlerPlugin = plugin;
