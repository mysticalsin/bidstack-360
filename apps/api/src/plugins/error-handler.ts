// Centralized error handler. Maps Zod validation, Prisma known errors, and
// thrown HTTP errors into structured RFC-7807-ish JSON.

import { Prisma } from '@bidstack/db';
import type { FastifyError, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';

const plugin: FastifyPluginAsync = fp(async (server) => {
  server.setErrorHandler((err: FastifyError, req, reply) => {
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

    if (err.statusCode && err.statusCode < 500) {
      // Sanitize: never echo raw error messages to the client. They may contain
      // internal paths, SQL fragments, or third-party URLs.
      const safeMessage =
        err.statusCode === 400
          ? 'Bad Request'
          : err.statusCode === 401
            ? 'Unauthorized'
            : err.statusCode === 403
              ? 'Forbidden'
              : err.statusCode === 404
                ? 'Not Found'
                : err.statusCode === 409
                  ? 'Conflict'
                  : err.statusCode === 429
                    ? 'Too Many Requests'
                    : 'Request failed';
      return reply.status(err.statusCode).send({
        statusCode: err.statusCode,
        error: err.name,
        message: safeMessage,
      });
    }

    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Something went wrong',
    });
  });
});

export const errorHandlerPlugin = plugin;
