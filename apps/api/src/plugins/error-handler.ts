// Centralized error handler. Maps Zod validation, Prisma known errors, and
// thrown HTTP errors into structured RFC-7807-ish JSON.

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

    if (err.statusCode && err.statusCode < 500) {
      return reply.status(err.statusCode).send({
        statusCode: err.statusCode,
        error: err.name,
        message: err.message,
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
