// RFP NocoBase integration routes.
// Proxies CRUD to NocoBase collections and orchestrates the AI intake agent.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { nocobase } from '../lib/nocobase-client.js';
import { createLogger } from '../lib/logger.js';
import { runAgent } from '../services/agents/agents.service.js';
import {
  listAssignmentsForRfp,
  assignAgentToRfp,
  unassignAgentFromRfp,
} from '../services/agents/rfp-agent-assignments.service.js';
import {
  listOutputsForRfp,
  approveOutput,
  rejectOutput,
} from '../services/agents/rfp-agent-outputs.service.js';
import { runRfpAgent } from '../services/ai/dust-agent.service.js';

const log = createLogger({ name: 'rfp-nocobase' });

// ─── Schemas ────────────────────────────────────────────────────────────────

const RfpStatus = z.enum([
  'draft',
  'intake',
  'sectioning',
  'reviewing',
  'bid_decision',
  'drafting',
  'qa_review',
  'approved',
  'submitted',
  'archived',
]);

const RfpPriority = z.enum(['low', 'medium', 'high', 'critical']);
const RfpRecommendation = z.enum(['pending', 'bid', 'no_bid', 'conditional']);

const RfpRequest = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: RfpStatus,
  submissionDeadline: z.string().datetime().nullable(),
  questionDeadline: z.string().datetime().nullable(),
  industry: z.string().nullable(),
  region: z.string().nullable(),
  priority: RfpPriority,
  bidRecommendation: RfpRecommendation,
  winProbabilityBps: z.number().int(),
  riskScore: z.number().int(),
  complianceScore: z.number().int(),
  aiSummary: z.string().nullable(),
  executiveBrief: z.record(z.unknown()).nullable(),
  metadata: z.record(z.unknown()).nullable(),
  opportunityId: z.string().uuid().nullable(),
  companyId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const RfpDocument = z.object({
  id: z.string().uuid(),
  name: z.string(),
  fileType: z.string(),
  version: z.number().int(),
  source: z.string(),
  storageKey: z.string().nullable(),
  bytes: z.number().int().nullable(),
  ocrStatus: z.string(),
  extractionStatus: z.string(),
  parsedText: z.string().nullable(),
  documentClassification: z.string(),
  pageCount: z.number().int().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  rfpId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const RfpSection = z.object({
  id: z.string().uuid(),
  title: z.string(),
  sectionNumber: z.string().nullable(),
  pageStart: z.number().int().nullable(),
  pageEnd: z.number().int().nullable(),
  rawText: z.string().nullable(),
  sectionType: z.string(),
  assignedAgentType: z.string(),
  importanceLevel: z.string(),
  riskLevel: z.string(),
  complianceRelevance: z.boolean(),
  status: z.string(),
  aiSummary: z.string().nullable(),
  extractedRequirements: z.array(z.record(z.unknown())),
  confidenceBps: z.number().int(),
  rfpId: z.string().uuid().nullable(),
  documentId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// ─── Mock Intake Agent ──────────────────────────────────────────────────────
// Replaced with real LLM call when API keys are configured.

interface IntakeResult {
  clientName: string;
  rfpTitle: string;
  submissionDeadline: string | null;
  questionDeadline: string | null;
  contactEmail: string | null;
  submissionMethod: string;
  requiredFormat: string;
  mandatoryAttachments: string[];
  evaluationCriteria: string[];
  disqualificationClauses: string[];
  confidence: number;
}

async function mockIntakeAgent(parsedText: string): Promise<IntakeResult> {
  // Simulate processing delay
  await new Promise((r) => setTimeout(r, 800));

  // Extract basic info using regex heuristics for the POC
  const lines = parsedText.split('\n').slice(0, 200);
  const textSample = lines.join('\n').slice(0, 5000);

  const titleMatch = textSample.match(
    /(?:request for proposal|RFP|tender|invitation to tender)[\s:]*([^\n]{10,200})/i,
  );
  const clientMatch = textSample.match(
    /(?:from|issued by|client|organization)[\s:]*([^\n]{5,100})/i,
  );
  const deadlineMatch = textSample.match(
    /(?:submission deadline|due date|closing date)[\s:]*([^\n]{5,80})/i,
  );

  return {
    clientName: clientMatch?.[1]?.trim() ?? 'Unknown Client',
    rfpTitle: titleMatch?.[1]?.trim() ?? 'Untitled RFP',
    submissionDeadline: deadlineMatch
      ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      : null,
    questionDeadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    contactEmail: textSample.match(/[\w.-]+@[\w.-]+\.\w+/)?.[0] ?? null,
    submissionMethod: textSample.includes('portal') ? 'portal' : 'email',
    requiredFormat: textSample.includes('PDF') ? 'PDF' : 'unspecified',
    mandatoryAttachments: ['company profile', 'financial statements', 'references'].filter((k) =>
      textSample.toLowerCase().includes(k),
    ),
    evaluationCriteria: ['price', 'technical', 'experience'].filter((k) =>
      textSample.toLowerCase().includes(k),
    ),
    disqualificationClauses: ['late submission', 'incomplete proposal'].filter((k) =>
      textSample.toLowerCase().includes(k),
    ),
    confidence: 0.72,
  };
}

// ─── Mock Structuring Agent ─────────────────────────────────────────────────

interface SectionResult {
  title: string;
  sectionNumber: string;
  sectionType: string;
  importanceLevel: string;
  briefSummary: string;
}

async function mockStructuringAgent(parsedText: string): Promise<SectionResult[]> {
  await new Promise((r) => setTimeout(r, 600));

  const sections: SectionResult[] = [];
  const lines = parsedText.split('\n');
  let currentSection: { title: string; lines: string[] } | null = null;
  let sectionCount = 0;

  for (const line of lines) {
    const headingMatch = line.match(/^(\d+(?:\.\d+)*|\d+)\.?\s+([A-Z][A-Za-z\s&]{5,80})$/);
    if (headingMatch) {
      if (currentSection) {
        const text = currentSection.lines.join('\n').toLowerCase();
        sections.push({
          title: currentSection.title,
          sectionNumber: headingMatch[1] ?? '',
          sectionType: detectSectionType(text),
          importanceLevel: detectImportance(text),
          briefSummary: currentSection.lines.slice(0, 3).join(' ').slice(0, 200),
        });
      }
      currentSection = { title: headingMatch[2] ?? '', lines: [] };
      sectionCount++;
      if (sectionCount >= 15) break;
    } else if (currentSection) {
      currentSection.lines.push(line);
    }
  }

  // Add final section
  if (currentSection && currentSection.lines.length > 0) {
    const text = currentSection.lines.join('\n').toLowerCase();
    sections.push({
      title: currentSection.title,
      sectionNumber: String(sectionCount),
      sectionType: detectSectionType(text),
      importanceLevel: detectImportance(text),
      briefSummary: currentSection.lines.slice(0, 3).join(' ').slice(0, 200),
    });
  }

  return sections.length > 0
    ? sections
    : [
        {
          title: 'General Requirements',
          sectionNumber: '1',
          sectionType: 'general',
          importanceLevel: 'high',
          briefSummary: 'Main proposal requirements',
        },
        {
          title: 'Technical Specifications',
          sectionNumber: '2',
          sectionType: 'technical',
          importanceLevel: 'critical',
          briefSummary: 'Technical delivery requirements',
        },
        {
          title: 'Commercial Terms',
          sectionNumber: '3',
          sectionType: 'commercial',
          importanceLevel: 'high',
          briefSummary: 'Pricing and payment terms',
        },
      ];
}

function detectSectionType(text: string): string {
  if (text.includes('legal') || text.includes('liability') || text.includes('indemnity'))
    return 'legal';
  if (text.includes('technical') || text.includes('architecture') || text.includes('system'))
    return 'technical';
  if (
    text.includes('price') ||
    text.includes('cost') ||
    text.includes('budget') ||
    text.includes('financial')
  )
    return 'commercial';
  if (text.includes('security') || text.includes('cyber') || text.includes('iso 27001'))
    return 'security';
  if (text.includes('delivery') || text.includes('timeline') || text.includes('schedule'))
    return 'delivery';
  if (text.includes('compliance') || text.includes('regulatory') || text.includes('certification'))
    return 'compliance';
  if (text.includes('evaluation') || text.includes('criteria') || text.includes('scoring'))
    return 'evaluation';
  return 'general';
}

function detectImportance(text: string): string {
  if (
    text.includes('mandatory') ||
    text.includes('must') ||
    text.includes('required') ||
    text.includes('critical')
  )
    return 'critical';
  if (text.includes('important') || text.includes('shall') || text.includes('essential'))
    return 'high';
  return 'medium';
}

// ─── Routes ─────────────────────────────────────────────────────────────────

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
          name: z.string().min(1),
          opportunityId: z.string().uuid().optional(),
          companyId: z.string().uuid().optional(),
          status: RfpStatus.optional(),
          submissionDeadline: z.string().datetime().optional(),
          questionDeadline: z.string().datetime().optional(),
          industry: z.string().optional(),
          region: z.string().optional(),
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
          name: z.string().min(1).optional(),
          status: RfpStatus.optional(),
          submissionDeadline: z.string().datetime().optional(),
          questionDeadline: z.string().datetime().optional(),
          priority: RfpPriority.optional(),
          bidRecommendation: RfpRecommendation.optional(),
          winProbabilityBps: z.number().int().min(0).max(10000).optional(),
          riskScore: z.number().int().min(0).max(100).optional(),
          complianceScore: z.number().int().min(0).max(100).optional(),
          aiSummary: z.string().optional(),
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

  // ── Run intake agent ──────────────────────────────────────────────────────
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
      const intake = await mockIntakeAgent(req.body.parsedText);

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
      const sectionData = await mockStructuringAgent(req.body.parsedText);

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

      // Find assignment for this RFP + agent phase
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

  // ── RFP Agent Assignments ─────────────────────────────────────────────────
  server.get(
    '/rfp/:id/assignments',
    {
      config: { permission: 'opportunities:read' },
      schema: {
        params: z.object({ id: z.string().uuid() }),
      },
    },
    async (req) => {
      return listAssignmentsForRfp(req.auth.orgId, req.params.id);
    },
  );

  server.post(
    '/rfp/:id/assignments',
    {
      config: { permission: 'opportunities:write' },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          agentId: z.string().uuid(),
        }),
      },
    },
    async (req) => {
      return assignAgentToRfp(req.auth.orgId, req.body.agentId, req.params.id);
    },
  );

  server.delete(
    '/rfp/:id/assignments/:assignmentId',
    {
      config: { permission: 'opportunities:write' },
      schema: {
        params: z.object({
          id: z.string().uuid(),
          assignmentId: z.string().uuid(),
        }),
      },
    },
    async (req) => {
      return unassignAgentFromRfp(req.auth.orgId, req.params.assignmentId);
    },
  );

  // ── RFP Agent Outputs ──────────────────────────────────────────────────────
  server.get(
    '/rfp/:id/outputs',
    {
      config: { permission: 'opportunities:read' },
      schema: {
        params: z.object({ id: z.string().uuid() }),
      },
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
        params: z.object({
          id: z.string().uuid(),
          outputId: z.string(),
        }),
      },
    },
    async (req) => {
      return approveOutput(req.params.outputId, req.auth.userId);
    },
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
        body: z.object({
          reason: z.string().min(1),
        }),
      },
    },
    async (req) => {
      return rejectOutput(req.params.outputId, req.auth.userId, req.body.reason);
    },
  );
};

// Background intake + structuring helper.
// WHY orgId/userId params: runRfpAgent requires orgId for EU AI Act audit logging
// (logAiInvocation records which org triggered the AI call). userId surfaces the
// initiating user in the audit trail when available.
async function runIntakeAndStructuring(
  rfpId: string,
  docId: string,
  parsedText: string,
  orgId: string,
  userId?: string,
) {
  const start = Date.now();

  let intake: IntakeResult;
  let sectionData: SectionResult[];

  // Attempt Dust AI agent first; fall back to regex heuristics if Dust is unconfigured.
  // WHY try/catch on the whole block: if intake succeeds but structuring fails, we
  // still want the NocoBase rows from intake to be written. Separate try/catches
  // below handle each phase independently.
  let dustUsed = false;
  try {
    const result = await runRfpAgent({
      orgId,
      userId,
      templateId: 'rfp-intake-agent',
      trusted: { rfpId },
      rfpContent: parsedText,
    });
    // WHY: Dust agent returns JSON; map to IntakeResult shape. Default to heuristic
    // values for any field the agent omits — partial output is better than no output.
    const out = result.output as Record<string, unknown>;
    intake = {
      clientName: String(out.clientName ?? 'Unknown Client'),
      rfpTitle: String(out.rfpTitle ?? 'Untitled RFP'),
      submissionDeadline: out.submissionDeadline ? String(out.submissionDeadline) : null,
      questionDeadline: out.questionDeadline ? String(out.questionDeadline) : null,
      contactEmail: out.contactEmail ? String(out.contactEmail) : null,
      submissionMethod: String(out.submissionMethod ?? 'email'),
      requiredFormat: String(out.requiredFormat ?? 'unspecified'),
      mandatoryAttachments: Array.isArray(out.mandatoryAttachments)
        ? out.mandatoryAttachments.map(String)
        : [],
      evaluationCriteria: Array.isArray(out.evaluationCriteria)
        ? out.evaluationCriteria.map(String)
        : [],
      disqualificationClauses: Array.isArray(out.disqualificationClauses)
        ? out.disqualificationClauses.map(String)
        : [],
      confidence: typeof out.confidence === 'number' ? out.confidence : 0.8,
    };
    dustUsed = true;
  } catch (err) {
    // WHY: Dust not configured or temporarily unavailable — degrade gracefully.
    // The regex heuristics provide a reasonable stub so the pipeline doesn't halt.
    log.warn({ err, rfpId }, 'Dust intake agent unavailable — falling back to regex heuristics');
    intake = await mockIntakeAgent(parsedText);
  }

  await nocobase.update('rfp_requests', rfpId, {
    status: 'sectioning',
    submissionDeadline: intake.submissionDeadline,
    questionDeadline: intake.questionDeadline,
    aiSummary: `Client: ${intake.clientName}. Method: ${intake.submissionMethod}. Format: ${intake.requiredFormat}.`,
    metadata: { intake, dustUsed },
  });

  // WHY: structuring is a separate agent call so its failure doesn't block intake results.
  try {
    const structResult = await runRfpAgent({
      orgId,
      userId,
      templateId: 'rfp-structuring-agent',
      trusted: { rfpId },
      rfpContent: parsedText,
    });
    const rawSections = structResult.output.sections;
    sectionData = Array.isArray(rawSections)
      ? (rawSections as Record<string, unknown>[]).map((s) => ({
          title: String(s.title ?? 'Untitled Section'),
          sectionNumber: String(s.sectionNumber ?? '1'),
          sectionType: String(s.sectionType ?? 'general'),
          importanceLevel: String(s.importanceLevel ?? 'medium'),
          briefSummary: String(s.briefSummary ?? ''),
        }))
      : await mockStructuringAgent(parsedText);
  } catch {
    // WHY: structuring Dust call failed — heuristic fallback preserves usable sections.
    sectionData = await mockStructuringAgent(parsedText);
  }

  for (const s of sectionData) {
    await nocobase.create('rfp_sections', {
      rfpId,
      documentId: docId,
      title: s.title,
      sectionNumber: s.sectionNumber,
      sectionType: s.sectionType,
      importanceLevel: s.importanceLevel,
      status: 'ready',
      aiSummary: s.briefSummary,
    });
  }

  await nocobase.update('rfp_documents', docId, { extractionStatus: 'done' });
  log.info({ rfpId, docId, dustUsed, duration: Date.now() - start }, 'background intake complete');
}

export default plugin;
