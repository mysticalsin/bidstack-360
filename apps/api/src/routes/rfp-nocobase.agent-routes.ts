/**
 * rfp-nocobase.agent-routes.ts — AI agent & collaboration routes for the RFP pipeline.
 * Registered as a Fastify sub-plugin by rfp-nocobase.ts.
 *
 * Covers:
 *   POST /rfp/:id/intake          — synchronous intake + structuring pipeline
 *   POST /rfp/:id/agents/:type/run — trigger an assigned agent
 *   GET/POST/DELETE /rfp/:id/assignments
 *   GET/POST /rfp/:id/outputs/:outputId/(approve|reject)
 *
 * WHY separate from rfp-nocobase.ts: agent/workflow routes depend on 5 service
 * imports not needed by the CRUD routes, and grouping them here keeps each file
 * under the 400-line cap.
 *
 * Import DAG: rfp-nocobase.helpers (leaf) ← this file ← rfp-nocobase.ts
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { createLogger } from '../lib/logger.js';
import { nocobase } from '../lib/nocobase-client.js';
import { runAgent } from '../services/agents/agents.service.js';
import {
  assignAgentToRfp,
  listAssignmentsForRfp,
  unassignAgentFromRfp,
} from '../services/agents/rfp-agent-assignments.service.js';
import {
  approveOutput,
  listOutputsForRfp,
  rejectOutput,
} from '../services/agents/rfp-agent-outputs.service.js';
import {
  type IntakeResult,
  type SectionResult,
  RfpRequest,
  RfpSection,
  mockIntakeAgent,
  mockStructuringAgent,
} from './rfp-nocobase.helpers.js';

const log = createLogger({ name: 'rfp-nocobase' });

export const rfpAgentRoutes: FastifyPluginAsyncZod = async (server) => {
  // ── Run intake agent ──────────────────────────────────────────────────────
  // Synchronous version of the background pipeline — awaits intake + structuring
  // and returns the created sections immediately. Used by the workspace UI.
  server.post(
    '/rfp/:id/intake',
    {
      config: { permission: 'opportunities:write' },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          documentId: z.string().uuid().optional(),
          parsedText: z.string().min(10),
        }),
        response: {
          200: z.object({
            rfp: RfpRequest,
            sections: z.array(RfpSection),
            agentRun: z.object({
              intakeConfidence: z.number(),
              sectionsCreated: z.number(),
              durationMs: z.number(),
            }),
          }),
        },
      },
    },
    async (req) => {
      const start = Date.now();

      // 1. Run intake agent
      const intake: IntakeResult = await mockIntakeAgent(req.body.parsedText);

      // 2. Update RFP with extracted metadata
      const rfp = await nocobase.update<z.infer<typeof RfpRequest>>('rfp_requests', req.params.id, {
        status: 'sectioning',
        submissionDeadline: intake.submissionDeadline,
        questionDeadline: intake.questionDeadline,
        aiSummary: `Client: ${intake.clientName}. Method: ${intake.submissionMethod}. Format: ${intake.requiredFormat}. Attachments: ${intake.mandatoryAttachments.join(', ')}.`,
        metadata: {
          intake: {
            contactEmail: intake.contactEmail,
            submissionMethod: intake.submissionMethod,
            requiredFormat: intake.requiredFormat,
            mandatoryAttachments: intake.mandatoryAttachments,
            evaluationCriteria: intake.evaluationCriteria,
            disqualificationClauses: intake.disqualificationClauses,
            confidence: intake.confidence,
          },
        },
      });

      // 3. Run structuring agent
      const sectionData: SectionResult[] = await mockStructuringAgent(req.body.parsedText);

      // 4. Create sections
      const sections: z.infer<typeof RfpSection>[] = [];
      for (const s of sectionData) {
        const section = await nocobase.create<z.infer<typeof RfpSection>>('rfp_sections', {
          rfpId: req.params.id,
          documentId: req.body.documentId ?? null,
          title: s.title,
          sectionNumber: s.sectionNumber,
          sectionType: s.sectionType,
          importanceLevel: s.importanceLevel,
          riskLevel: s.importanceLevel === 'critical' ? 'high' : 'medium',
          status: 'ready',
          aiSummary: s.briefSummary,
          confidenceBps: Math.round(intake.confidence * 10000),
        });
        sections.push(section);
      }

      // 5. Update document status
      if (req.body.documentId) {
        await nocobase.update('rfp_documents', req.body.documentId, {
          extractionStatus: 'done',
          documentClassification: 'rfp',
        });
      }

      const duration = Date.now() - start;
      log.info(
        { rfpId: req.params.id, sections: sections.length, duration },
        'RFP intake completed',
      );

      return {
        rfp,
        sections,
        agentRun: {
          intakeConfidence: intake.confidence,
          sectionsCreated: sections.length,
          durationMs: duration,
        },
      };
    },
  );

  // ── Run assigned agent on RFP ─────────────────────────────────────────────
  server.post(
    '/rfp/:id/agents/:agentType/run',
    {
      config: { permission: 'opportunities:write' },
      preHandler: server.requirePermission('opportunities:write'),
      schema: {
        params: z.object({ id: z.string().uuid(), agentType: z.string().min(1) }),
        body: z
          .object({
            message: z.string().optional(),
          })
          .default({}),
        response: {
          200: z.object({ run: z.record(z.unknown()), outputId: z.string().optional() }),
        },
      },
    },
    async (req) => {
      const rfpId = req.params.id;

      const assignments = await listAssignmentsForRfp(req.auth.orgId, rfpId);
      const assignment = assignments.items.find(
        (a) => a.agent.config.phase === req.params.agentType || a.agent.id === req.params.agentType,
      );

      if (!assignment) {
        throw server.httpErrors.notFound('No agent assigned to this RFP for the given type');
      }

      const runResult = await runAgent(req.auth.orgId, req.auth.userId, assignment.agentId, {
        message: req.body.message ?? `Run ${assignment.agent.name} on RFP ${rfpId}`,
        rfpRequestId: rfpId,
      });

      if (!runResult) {
        throw server.httpErrors.notFound('Agent not found');
      }

      return { run: runResult };
    },
  );

  // ── RFP Agent Assignments ─────────────────────────────────────────────────

  server.get(
    '/rfp/:id/assignments',
    {
      config: { permission: 'opportunities:read' },
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (req) => listAssignmentsForRfp(req.auth.orgId, req.params.id),
  );

  server.post(
    '/rfp/:id/assignments',
    {
      config: { permission: 'opportunities:write' },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ agentId: z.string().uuid() }),
      },
    },
    async (req) => assignAgentToRfp(req.auth.orgId, req.body.agentId, req.params.id),
  );

  server.delete(
    '/rfp/:id/assignments/:assignmentId',
    {
      config: { permission: 'opportunities:write' },
      schema: {
        params: z.object({ id: z.string().uuid(), assignmentId: z.string().uuid() }),
      },
    },
    async (req) => unassignAgentFromRfp(req.auth.orgId, req.params.assignmentId),
  );

  // ── RFP Agent Outputs ──────────────────────────────────────────────────────

  server.get(
    '/rfp/:id/outputs',
    {
      config: { permission: 'opportunities:read' },
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (req) => {
      const items = await listOutputsForRfp(req.params.id);
      return { items };
    },
  );

  server.post(
    '/rfp/:id/outputs/:outputId/approve',
    {
      config: { permission: 'opportunities:write' },
      schema: {
        params: z.object({ id: z.string().uuid(), outputId: z.string() }),
      },
    },
    async (req) => approveOutput(req.params.outputId, req.auth.userId),
  );

  server.post(
    '/rfp/:id/outputs/:outputId/reject',
    {
      config: { permission: 'opportunities:write' },
      schema: {
        params: z.object({
          id: z.string().uuid(),
          outputId: z.string(),
        }),
        body: z.object({ reason: z.string().min(1) }),
      },
    },
    async (req) => rejectOutput(req.params.outputId, req.auth.userId, req.body.reason),
  );
};
