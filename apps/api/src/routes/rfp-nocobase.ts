// RFP NocoBase integration routes — CRUD operations.
// AI agent & workflow routes are registered via the rfpAgentRoutes sub-plugin.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { createLogger } from '../lib/logger.js';
import { nocobase } from '../lib/nocobase-client.js';
import { rfpAgentRoutes } from './rfp-nocobase.agent-routes.js';
import {
  RfpDocument,
  RfpPriority,
  RfpRecommendation,
  RfpRequest,
  RfpSection,
  RfpStatus,
  runIntakeAndStructuring,
} from './rfp-nocobase.helpers.js';

const log = createLogger({ name: 'rfp-nocobase' });

const plugin: FastifyPluginAsyncZod = async (server) => {
  // ── List RFPs ─────────────────────────────────────────────────────────────
  server.get(
    '/rfp',
    {
      config: { permission: 'opportunities:read' },
      schema: {
        querystring: z.object({
          page: z.coerce.number().default(1),
          pageSize: z.coerce.number().default(20),
          status: z.string().optional(),
        }),
        response: {
          200: z.object({
            items: z.array(RfpRequest),
            meta: z.object({ count: z.number(), page: z.number(), pageSize: z.number() }),
          }),
        },
      },
    },
    async (req) => {
      const { page, pageSize, status } = req.query;
      const filter: Record<string, unknown> = {};
      if (status) filter.status = status;

      const result = await nocobase.list<z.infer<typeof RfpRequest>>('rfp_requests', {
        filter,
        page,
        pageSize,
        sort: ['-createdAt'],
      });

      return { items: result.data, meta: result.meta };
    },
  );

  // ── Get single RFP ────────────────────────────────────────────────────────
  server.get(
    '/rfp/:id',
    {
      config: { permission: 'opportunities:read' },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: RfpRequest },
      },
    },
    async (req) => {
      return nocobase.get<z.infer<typeof RfpRequest>>('rfp_requests', req.params.id, {
        appends: ['documents', 'sections'],
      });
    },
  );

  // ── Create RFP ────────────────────────────────────────────────────────────
  server.post(
    '/rfp',
    {
      config: { permission: 'opportunities:write' },
      schema: {
        body: z.object({
          name: z.string().min(1).max(255),
          opportunityId: z.string().uuid().optional(),
          companyId: z.string().uuid().optional(),
          status: RfpStatus.optional(),
          submissionDeadline: z.string().datetime().optional(),
          questionDeadline: z.string().datetime().optional(),
          industry: z.string().max(100).optional(),
          region: z.string().max(100).optional(),
          priority: RfpPriority.optional(),
        }),
        response: { 201: RfpRequest },
      },
    },
    async (req, reply) => {
      const rfp = await nocobase.create<z.infer<typeof RfpRequest>>('rfp_requests', {
        ...req.body,
        status: req.body.status ?? 'draft',
      });
      return reply.status(201).send(rfp);
    },
  );

  // ── Update RFP ────────────────────────────────────────────────────────────
  server.patch(
    '/rfp/:id',
    {
      config: { permission: 'opportunities:write' },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          name: z.string().min(1).max(255).optional(),
          status: RfpStatus.optional(),
          submissionDeadline: z.string().datetime().optional(),
          questionDeadline: z.string().datetime().optional(),
          priority: RfpPriority.optional(),
          bidRecommendation: RfpRecommendation.optional(),
          winProbabilityBps: z.number().int().min(0).max(10000).optional(),
          riskScore: z.number().int().min(0).max(100).optional(),
          complianceScore: z.number().int().min(0).max(100).optional(),
          aiSummary: z.string().max(10_000).optional(),
          metadata: z.record(z.unknown()).optional(),
        }),
        response: { 200: RfpRequest },
      },
    },
    async (req) => {
      return nocobase.update<z.infer<typeof RfpRequest>>('rfp_requests', req.params.id, req.body);
    },
  );

  // ── Upload document ───────────────────────────────────────────────────────
  server.post(
    '/rfp/:id/documents',
    {
      config: { permission: 'opportunities:write' },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          name: z.string(),
          fileType: z.string().default('pdf'),
          source: z.string().default('upload'),
          parsedText: z.string().optional(),
          pageCount: z.number().int().optional(),
        }),
        response: { 201: RfpDocument },
      },
    },
    async (req, reply) => {
      const doc = await nocobase.create<z.infer<typeof RfpDocument>>('rfp_documents', {
        ...req.body,
        rfpId: req.params.id,
        version: 1,
        ocrStatus: req.body.parsedText ? 'done' : 'pending',
        extractionStatus: req.body.parsedText ? 'done' : 'pending',
      });

      // If text is already parsed, trigger intake workflow asynchronously
      if (req.body.parsedText) {
        // Fire-and-forget: run intake + structuring in background.
        // WHY: we don't await so the upload response returns immediately to the client;
        // the background job updates the rfp_requests row and creates sections asynchronously.
        void runIntakeAndStructuring(
          req.params.id,
          doc.id,
          req.body.parsedText,
          req.auth.orgId,
          req.auth.userId,
        ).catch((err) => {
          log.error({ err, rfpId: req.params.id, docId: doc.id }, 'intake/structuring failed');
        });
      }

      return reply.status(201).send(doc);
    },
  );

  // ── List RFP sections ─────────────────────────────────────────────────────
  server.get(
    '/rfp/:id/sections',
    {
      config: { permission: 'opportunities:read' },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.array(RfpSection) },
      },
    },
    async (req) => {
      const result = await nocobase.list<z.infer<typeof RfpSection>>('rfp_sections', {
        filter: { rfpId: req.params.id },
        sort: ['sectionNumber'],
      });
      return result.data;
    },
  );

  // ── List RFP documents ────────────────────────────────────────────────────
  server.get(
    '/rfp/:id/documents',
    {
      config: { permission: 'opportunities:read' },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.array(RfpDocument) },
      },
    },
    async (req) => {
      const result = await nocobase.list<z.infer<typeof RfpDocument>>('rfp_documents', {
        filter: { rfpId: req.params.id },
        sort: ['-createdAt'],
      });
      return result.data;
    },
  );

  // ── Delete RFP ────────────────────────────────────────────────────────────
  server.delete(
    '/rfp/:id',
    {
      config: { permission: 'opportunities:write' },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 204: z.void() },
      },
    },
    async (req, reply) => {
      await nocobase.destroy('rfp_requests', req.params.id);
      return reply.status(204).send();
    },
  );

  // ── Agent & collaboration routes (sub-plugin) ─────────────────────────────
  await server.register(rfpAgentRoutes);
};

export default plugin;
