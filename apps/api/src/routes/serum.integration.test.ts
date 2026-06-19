import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let previousStubRoleHeader: string | undefined;
const configKey = `e2e-${Date.now()}`;
const approverHeaders = { 'x-bidstack-e2e-role': 'admin' };

beforeAll(async () => {
  previousStubRoleHeader = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const org = await prisma.org.findUnique({ where: { clerkOrg: 'org_seed_mantu' } });
  orgId = org?.id ?? null;
  if (!orgId) return;

  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (dbReachable && orgId) {
    await prisma.serumConnectorConnectionTest.deleteMany({
      where: { orgId, operation: { startsWith: configKey } },
    });
    await prisma.serumConfigVersion.deleteMany({
      where: { orgId, configKey: { startsWith: configKey } },
    });
  }
  if (server) await server.close();
  if (dbReachable) await prisma.$disconnect();
  if (previousStubRoleHeader === undefined) {
    delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  } else {
    process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previousStubRoleHeader;
  }
});

const skipIfNoDb = (name: string, fn: () => Promise<void> | void) =>
  it(name, async () => {
    if (!dbReachable || !orgId) {
      throw new Error(`[skip] ${name} - DATABASE_URL not reachable or seed org missing`);
    }
    await fn();
  });

async function publishHighRiskConfig(args: {
  configType:
    | 'agents'
    | 'loops'
    | 'tools'
    | 'connectors'
    | 'model_router'
    | 'dust_mcp_gateway'
    | 'prompt_library'
    | 'evals_quality_gates';
  configKey: string;
  configJson: Record<string, unknown>;
  changeReason: string;
}) {
  const draft = await server.inject({
    method: 'POST',
    url: `/api/v1/serum/configs/${args.configType}/${args.configKey}/draft`,
    payload: {
      environment: 'dev',
      configJson: args.configJson,
      changeReason: args.changeReason,
    },
  });
  expect(draft.statusCode).toBe(200);
  const draftBody = draft.json() as { id: string };

  const requestApproval = await server.inject({
    method: 'POST',
    url: `/api/v1/serum/configs/${draftBody.id}/request-approval`,
    payload: { approvalReason: `${args.changeReason} approval request` },
  });
  expect(requestApproval.statusCode).toBe(200);

  const approve = await server.inject({
    method: 'POST',
    url: `/api/v1/serum/configs/${draftBody.id}/approve`,
    headers: approverHeaders,
    payload: { decisionNotes: `${args.changeReason} separate-admin approval` },
  });
  expect(approve.statusCode).toBe(200);

  const publish = await server.inject({
    method: 'POST',
    url: `/api/v1/serum/configs/${draftBody.id}/publish`,
    payload: { changeReason: `${args.changeReason} publish` },
  });
  expect(publish.statusCode).toBe(200);
  return publish.json() as { id: string; status: string; configType: string; configKey: string };
}

async function publishConfig(args: {
  configType: 'retrieval';
  configKey: string;
  configJson: Record<string, unknown>;
  changeReason: string;
}) {
  const draft = await server.inject({
    method: 'POST',
    url: `/api/v1/serum/configs/${args.configType}/${args.configKey}/draft`,
    payload: {
      environment: 'dev',
      configJson: args.configJson,
      changeReason: args.changeReason,
    },
  });
  expect(draft.statusCode).toBe(200);
  const draftBody = draft.json() as { id: string; approvalStatus: string };
  expect(draftBody.approvalStatus).toBe('not_required');

  const publish = await server.inject({
    method: 'POST',
    url: `/api/v1/serum/configs/${draftBody.id}/publish`,
    payload: { changeReason: `${args.changeReason} publish` },
  });
  expect(publish.statusCode).toBe(200);
  return publish.json() as { id: string; status: string; configType: string; configKey: string };
}

describe('SERUM status route', () => {
  skipIfNoDb('returns a status snapshot even when optional backend signals are empty', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/serum/status' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      cards?: unknown[];
      modules?: unknown[];
      generatedAt?: string;
      signalHealth?: unknown[];
    };
    expect(body.generatedAt).toEqual(expect.any(String));
    expect(body.cards?.length).toBeGreaterThan(0);
    expect(body.modules?.length).toBeGreaterThan(0);
    expect(body.signalHealth).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'source-tables',
          label: 'Source tables',
        }),
        expect.objectContaining({
          id: 'provider-heartbeats',
          label: 'Provider heartbeats',
        }),
        expect.objectContaining({
          id: 'queue-heartbeats',
          label: 'Queue heartbeats',
        }),
      ]),
    );
    const queryCount = Number(res.headers['x-query-count']);
    expect(Number.isFinite(queryCount)).toBe(true);
    expect(queryCount).toBeLessThanOrEqual(10);
    expect(String(res.headers['x-query-warnings'] ?? '')).not.toContain('N+1 detected');
  });

  skipIfNoDb('tests candidate high-risk config without persisting a version', async () => {
    const unsafe = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/configs/agents/${configKey}/test`,
      payload: {
        environment: 'dev',
        configJson: {
          enabled: true,
          autonomy: 'unrestricted_write',
          allowedAgentIds: [],
          maxConcurrentRuns: 100,
          humanApprovalRequired: false,
          provider: { apiKey: 'sk-do-not-store' },
        },
      },
    });
    expect(unsafe.statusCode).toBe(200);
    expect(unsafe.headers['cache-control']).toBe('no-store');
    const unsafeBody = unsafe.json() as {
      status: string;
      summary: string;
      checks: { id: string; label: string; status: string; detail: string }[];
    };
    expect(unsafeBody.status).toBe('fail');
    expect(unsafeBody.summary).toContain('failed');
    expect(unsafeBody.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'secret-material', status: 'fail' }),
        expect.objectContaining({ id: 'agents-approval', label: 'Human approval', status: 'fail' }),
        expect.objectContaining({ id: 'agents-allowlist', status: 'fail' }),
        expect.objectContaining({ id: 'agents-concurrency', status: 'fail' }),
        expect.objectContaining({ id: 'agents-autonomy', status: 'fail' }),
      ]),
    );

    const safe = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/configs/agents/${configKey}/test`,
      payload: {
        environment: 'dev',
        configJson: {
          enabled: false,
          autonomy: 'disabled',
          allowedAgentIds: [],
          maxConcurrentRuns: 0,
          humanApprovalRequired: true,
        },
      },
    });
    expect(safe.statusCode).toBe(200);
    const safeBody = safe.json() as { status: string; checks: { id: string; status: string }[] };
    expect(safeBody.status).toBe('pass');
    expect(safeBody.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'secret-material', status: 'pass' }),
        expect.objectContaining({ id: 'agents-approval', status: 'pass' }),
        expect.objectContaining({ id: 'agents-allowlist', status: 'pass' }),
      ]),
    );

    await expect(
      prisma.serumConfigVersion.count({
        where: { orgId: orgId!, configType: 'agents', configKey },
      }),
    ).resolves.toBe(0);
  });

  skipIfNoDb('requires approval before publishing high-risk config drafts', async () => {
    const draft = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/configs/agents/${configKey}/draft`,
      payload: {
        environment: 'dev',
        configJson: {
          enabled: true,
          autonomy: 'supervised',
          allowedAgentIds: ['agent-rfp'],
          maxConcurrentRuns: 2,
          humanApprovalRequired: true,
        },
        changeReason: 'create approved agents registry draft',
      },
    });
    expect(draft.statusCode).toBe(200);
    const draftBody = draft.json() as {
      id: string;
      status: string;
      approvalStatus: string;
      approvalReference: string | null;
    };
    expect(draftBody).toMatchObject({
      status: 'draft',
      approvalStatus: 'required',
      approvalReference: null,
    });

    const blockedPublish = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/configs/${draftBody.id}/publish`,
      payload: { changeReason: 'try publish without approval' },
    });
    expect(blockedPublish.statusCode).toBe(409);
    expect(blockedPublish.body).toContain('separate admins before publish');

    const requestApproval = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/configs/${draftBody.id}/request-approval`,
      payload: { approvalReason: 'operator reviewed agent allowlist and concurrency cap' },
    });
    expect(requestApproval.statusCode).toBe(200);
    const requested = requestApproval.json() as {
      approvalStatus: string;
      approvalRequestedAt: string | null;
      approvalRequestedByUserId: string | null;
      approvalRequestedByCurrentUser: boolean;
      approvalReference: string | null;
    };
    expect(requested.approvalStatus).toBe('requested');
    expect(requested.approvalRequestedAt).toEqual(expect.any(String));
    expect(requested.approvalRequestedByUserId).toEqual(expect.any(String));
    expect(requested.approvalRequestedByCurrentUser).toBe(true);
    expect(requested.approvalReference).toMatch(/^SERUM-AGENTS-/);

    const duplicateRequest = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/configs/${draftBody.id}/request-approval`,
      headers: approverHeaders,
      payload: { approvalReason: 'try to replace the original approval requester' },
    });
    expect(duplicateRequest.statusCode).toBe(409);
    expect(duplicateRequest.body).toContain('already been requested');

    const selfApprove = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/configs/${draftBody.id}/approve`,
      payload: { decisionNotes: 'try to self approve high-risk config' },
    });
    expect(selfApprove.statusCode).toBe(409);
    expect(selfApprove.body).toContain('different admin than the requester');

    const approve = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/configs/${draftBody.id}/approve`,
      headers: approverHeaders,
      payload: { decisionNotes: 'approved after deterministic preflight and admin review' },
    });
    expect(approve.statusCode).toBe(200);
    const approved = approve.json() as {
      approvalStatus: string;
      approvedByUserId: string | null;
      approvalApprovedAt: string | null;
      approvalRequestedByCurrentUser: boolean;
      approvalReference: string | null;
    };
    expect(approved.approvalStatus).toBe('approved');
    expect(approved.approvedByUserId).toEqual(expect.any(String));
    expect(approved.approvedByUserId).not.toBe(requested.approvalRequestedByUserId);
    expect(approved.approvalApprovedAt).toEqual(expect.any(String));
    expect(approved.approvalRequestedByCurrentUser).toBe(false);
    expect(approved.approvalReference).toBe(requested.approvalReference);

    const publish = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/configs/${draftBody.id}/publish`,
      payload: { changeReason: 'publish approved high-risk agents registry' },
    });
    expect(publish.statusCode).toBe(200);
    const published = publish.json() as {
      status: string;
      approvalStatus: string;
      approvedByUserId: string | null;
      approvalApprovedAt: string | null;
      activatedAt: string | null;
    };
    expect(published).toMatchObject({
      status: 'active',
      approvalStatus: 'approved',
    });
    expect(published.approvedByUserId).toBe(approved.approvedByUserId);
    expect(published.approvalApprovedAt).toBe(approved.approvalApprovedAt);
    expect(published.activatedAt).toEqual(expect.any(String));

    const auditActions = await prisma.auditLog.findMany({
      where: {
        orgId,
        targetType: 'serum_config_version',
        targetId: draftBody.id,
        action: {
          in: [
            'serum_config.approval.request',
            'serum_config.approval.approve',
            'serum_config.publish',
          ],
        },
      },
      select: { action: true },
    });
    expect(auditActions.map((entry) => entry.action)).toEqual(
      expect.arrayContaining([
        'serum_config.approval.request',
        'serum_config.approval.approve',
        'serum_config.publish',
      ]),
    );
  });

  skipIfNoDb('blocks approval requests when high-risk config tests fail', async () => {
    const draft = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/configs/tools/${configKey}/draft`,
      payload: {
        environment: 'dev',
        configJson: {
          enabled: true,
          registryMode: 'open_registry',
          allowedTools: [],
          allowWriteTools: true,
          requireDryRunForWriteTools: false,
        },
        changeReason: 'create unsafe tools registry draft',
      },
    });
    expect(draft.statusCode).toBe(200);
    const draftBody = draft.json() as { id: string; approvalStatus: string };
    expect(draftBody.approvalStatus).toBe('required');

    const requestApproval = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/configs/${draftBody.id}/request-approval`,
      payload: { approvalReason: 'try to approve unsafe tools registry' },
    });
    expect(requestApproval.statusCode).toBe(409);
    expect(requestApproval.body).toContain('blocked until deterministic config tests pass');
  });

  skipIfNoDb('fails closed when stored high-risk approval evidence is self-approved', async () => {
    const tamperKey = `${configKey}-self-approved`;
    const draft = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/configs/agents/${tamperKey}/draft`,
      payload: {
        environment: 'dev',
        configJson: {
          enabled: true,
          autonomy: 'supervised',
          allowedAgentIds: ['agent-rfp'],
          maxConcurrentRuns: 1,
          humanApprovalRequired: true,
        },
        changeReason: 'create draft for self-approval evidence guard',
      },
    });
    expect(draft.statusCode).toBe(200);
    const draftBody = draft.json() as { id: string };

    const requestApproval = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/configs/${draftBody.id}/request-approval`,
      payload: { approvalReason: 'request approval before simulating bad stored evidence' },
    });
    expect(requestApproval.statusCode).toBe(200);
    const requested = requestApproval.json() as {
      approvalRequestedByUserId: string;
      approvalReference: string;
    };

    await prisma.serumConfigVersion.update({
      where: { id: draftBody.id },
      data: {
        approvalStatus: 'approved',
        approvedByUserId: requested.approvalRequestedByUserId,
        approvalApprovedAt: new Date(),
        approvalReference: requested.approvalReference,
      },
    });

    const publish = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/configs/${draftBody.id}/publish`,
      payload: { changeReason: 'try to publish self-approved stored evidence' },
    });
    expect(publish.statusCode).toBe(409);
    expect(publish.body).toContain('separate admins before publish');
  });

  skipIfNoDb('applies published high-risk runtime policies before execution', async () => {
    const runtimeKey = `${configKey}-runtime`;

    const missingPolicy = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/runtime-policy/agents/${runtimeKey}/check`,
      payload: { environment: 'dev', agentId: 'agent-rfp', approvalConfirmed: true },
    });
    expect(missingPolicy.statusCode).toBe(200);
    expect(missingPolicy.headers['cache-control']).toBe('no-store');
    expect(missingPolicy.json()).toMatchObject({
      allowed: false,
      status: 'not_configured',
      activeConfigVersionId: null,
    });

    await publishHighRiskConfig({
      configType: 'agents',
      configKey: runtimeKey,
      configJson: {
        enabled: true,
        autonomy: 'supervised',
        allowedAgentIds: ['agent-rfp'],
        maxConcurrentRuns: 25,
        humanApprovalRequired: true,
      },
      changeReason: 'publish executable agent runtime policy',
    });

    const agentWithoutApproval = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/runtime-policy/agents/${runtimeKey}/check`,
      payload: { environment: 'dev', agentId: 'agent-rfp', approvalConfirmed: false },
    });
    expect(agentWithoutApproval.statusCode).toBe(200);
    expect(agentWithoutApproval.json()).toMatchObject({
      allowed: false,
      status: 'denied',
    });

    const disallowedAgent = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/runtime-policy/agents/${runtimeKey}/check`,
      payload: { environment: 'dev', agentId: 'agent-unreviewed', approvalConfirmed: true },
    });
    expect(disallowedAgent.statusCode).toBe(200);
    expect(disallowedAgent.json()).toMatchObject({
      allowed: false,
      status: 'denied',
    });

    const allowedAgent = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/runtime-policy/agents/${runtimeKey}/check`,
      payload: { environment: 'dev', agentId: 'agent-rfp', approvalConfirmed: true },
    });
    expect(allowedAgent.statusCode).toBe(200);
    expect(allowedAgent.json()).toMatchObject({
      allowed: true,
      status: 'allowed',
      subject: 'agent-rfp',
    });

    await publishHighRiskConfig({
      configType: 'tools',
      configKey: runtimeKey,
      configJson: {
        enabled: true,
        registryMode: 'explicit_allowlist',
        allowedTools: ['opportunities.list', 'opportunity.update'],
        allowWriteTools: true,
        requireDryRunForWriteTools: true,
      },
      changeReason: 'publish executable tool runtime policy',
    });

    const disallowedTool = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/runtime-policy/tools/${runtimeKey}/check`,
      payload: { environment: 'dev', toolName: 'contacts.create', dryRun: true },
    });
    expect(disallowedTool.statusCode).toBe(200);
    expect(disallowedTool.json()).toMatchObject({ allowed: false, status: 'denied' });

    const writeWithoutDryRun = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/runtime-policy/tools/${runtimeKey}/check`,
      payload: { environment: 'dev', toolName: 'opportunity.update', dryRun: false },
    });
    expect(writeWithoutDryRun.statusCode).toBe(200);
    expect(writeWithoutDryRun.json()).toMatchObject({ allowed: false, status: 'denied' });

    const allowedTool = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/runtime-policy/tools/${runtimeKey}/check`,
      payload: { environment: 'dev', toolName: 'opportunity.update', dryRun: true },
    });
    expect(allowedTool.statusCode).toBe(200);
    expect(allowedTool.json()).toMatchObject({
      allowed: true,
      status: 'allowed',
      subject: 'opportunity.update',
    });

    const missingLoop = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/runtime-policy/loops/${runtimeKey}/check`,
      payload: {
        environment: 'dev',
        loopId: 'rfp-orchestrate:req-001',
        operation: 'rfp.orchestrate',
        retryCount: 0,
        hasDurableEvent: true,
        approvalGateReached: false,
      },
    });
    expect(missingLoop.statusCode).toBe(200);
    expect(missingLoop.json()).toMatchObject({
      allowed: false,
      status: 'not_configured',
      activeConfigVersionId: null,
    });

    await publishHighRiskConfig({
      configType: 'loops',
      configKey: runtimeKey,
      configJson: {
        enabled: true,
        durableEventsRequired: true,
        stopOnApprovalGate: true,
        replayMode: 'approval_required',
        maxRetries: 1,
      },
      changeReason: 'publish executable loop runtime policy',
    });

    const missingDurableEvent = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/runtime-policy/loops/${runtimeKey}/check`,
      payload: {
        environment: 'dev',
        loopId: 'rfp-orchestrate:req-001',
        operation: 'rfp.orchestrate',
        retryCount: 0,
        hasDurableEvent: false,
        approvalGateReached: false,
      },
    });
    expect(missingDurableEvent.statusCode).toBe(200);
    expect(missingDurableEvent.json()).toMatchObject({ allowed: false, status: 'denied' });

    const approvalBoundary = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/runtime-policy/loops/${runtimeKey}/check`,
      payload: {
        environment: 'dev',
        loopId: 'rfp-orchestrate:req-001',
        operation: 'rfp.orchestrate',
        retryCount: 0,
        hasDurableEvent: true,
        approvalGateReached: true,
      },
    });
    expect(approvalBoundary.statusCode).toBe(200);
    expect(approvalBoundary.json()).toMatchObject({ allowed: false, status: 'denied' });

    const overRetryCap = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/runtime-policy/loops/${runtimeKey}/check`,
      payload: {
        environment: 'dev',
        loopId: 'rfp-orchestrate:req-001',
        operation: 'rfp.orchestrate',
        retryCount: 2,
        hasDurableEvent: true,
        approvalGateReached: false,
      },
    });
    expect(overRetryCap.statusCode).toBe(200);
    expect(overRetryCap.json()).toMatchObject({ allowed: false, status: 'denied' });

    const replayWithoutApproval = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/runtime-policy/loops/${runtimeKey}/check`,
      payload: {
        environment: 'dev',
        loopId: 'rfp-orchestrate:req-001',
        operation: 'rfp.replay',
        retryCount: 0,
        hasDurableEvent: true,
        approvalGateReached: false,
        replayRequested: true,
        approvalConfirmed: false,
      },
    });
    expect(replayWithoutApproval.statusCode).toBe(200);
    expect(replayWithoutApproval.json()).toMatchObject({ allowed: false, status: 'denied' });

    const allowedLoop = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/runtime-policy/loops/${runtimeKey}/check`,
      payload: {
        environment: 'dev',
        loopId: 'rfp-orchestrate:req-001',
        operation: 'rfp.orchestrate',
        retryCount: 1,
        hasDurableEvent: true,
        approvalGateReached: false,
      },
    });
    expect(allowedLoop.statusCode).toBe(200);
    expect(allowedLoop.json()).toMatchObject({
      allowed: true,
      status: 'allowed',
      subject: 'rfp.orchestrate:rfp-orchestrate:req-001',
    });

    const missingConnector = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/runtime-policy/connectors/${runtimeKey}/check`,
      payload: {
        environment: 'dev',
        connectorId: 'odoo',
        operation: 'erp.search',
        writeRequested: false,
      },
    });
    expect(missingConnector.statusCode).toBe(200);
    expect(missingConnector.json()).toMatchObject({
      allowed: false,
      status: 'not_configured',
      activeConfigVersionId: null,
    });

    await publishHighRiskConfig({
      configType: 'connectors',
      configKey: runtimeKey,
      configJson: {
        enabled: true,
        connectorMode: 'read_only',
        requireConnectionTest: true,
        secretRefs: ['connector:odoo-prod'],
      },
      changeReason: 'publish executable connector runtime policy',
    });

    const untestedConnector = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/runtime-policy/connectors/${runtimeKey}/check`,
      payload: {
        environment: 'dev',
        connectorId: 'odoo',
        operation: 'erp.search',
        writeRequested: false,
      },
    });
    expect(untestedConnector.statusCode).toBe(200);
    expect(untestedConnector.json()).toMatchObject({ allowed: false, status: 'denied' });

    await prisma.serumConnectorConnectionTest.create({
      data: {
        orgId: orgId!,
        environment: 'dev',
        connectorId: 'odoo',
        operation: `${runtimeKey}.erp.connection`,
        status: 'success',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        evidence: { test: 'serum-runtime-policy' },
      },
    });

    const blockedConnectorWrite = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/runtime-policy/connectors/${runtimeKey}/check`,
      payload: {
        environment: 'dev',
        connectorId: 'odoo',
        operation: 'erp.push',
        writeRequested: true,
      },
    });
    expect(blockedConnectorWrite.statusCode).toBe(200);
    expect(blockedConnectorWrite.json()).toMatchObject({ allowed: false, status: 'denied' });

    const allowedConnector = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/runtime-policy/connectors/${runtimeKey}/check`,
      payload: {
        environment: 'dev',
        connectorId: 'odoo',
        operation: 'erp.search',
        writeRequested: false,
      },
    });
    expect(allowedConnector.statusCode).toBe(200);
    expect(allowedConnector.json()).toMatchObject({
      allowed: true,
      status: 'allowed',
      subject: 'erp.search:odoo',
    });

    await publishHighRiskConfig({
      configType: 'model_router',
      configKey: runtimeKey,
      configJson: {
        defaultProvider: 'gemma',
        fallbackProvider: null,
        secretRefs: ['agent-provider:gemma'],
        maxTokensPerRequest: 2000,
        requireSourceCitations: true,
        uncertaintyMode: 'answer_with_limits',
      },
      changeReason: 'publish executable model router runtime policy',
    });

    const overBudgetModel = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/runtime-policy/model-router/${runtimeKey}/check`,
      payload: {
        environment: 'dev',
        provider: 'gemma',
        requestedMaxTokens: 2500,
        sourceCitationsRequired: true,
      },
    });
    expect(overBudgetModel.statusCode).toBe(200);
    expect(overBudgetModel.json()).toMatchObject({ allowed: false, status: 'denied' });

    const noCitationModel = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/runtime-policy/model-router/${runtimeKey}/check`,
      payload: {
        environment: 'dev',
        provider: 'gemma',
        requestedMaxTokens: 1000,
        sourceCitationsRequired: false,
      },
    });
    expect(noCitationModel.statusCode).toBe(200);
    expect(noCitationModel.json()).toMatchObject({ allowed: false, status: 'denied' });

    const allowedModel = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/runtime-policy/model-router/${runtimeKey}/check`,
      payload: {
        environment: 'dev',
        provider: 'gemma',
        requestedMaxTokens: 1000,
        sourceCitationsRequired: true,
      },
    });
    expect(allowedModel.statusCode).toBe(200);
    expect(allowedModel.json()).toMatchObject({
      allowed: true,
      status: 'allowed',
      subject: 'gemma',
    });

    const missingGateway = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/runtime-policy/dust-mcp-gateway/${runtimeKey}/check`,
      payload: {
        environment: 'dev',
        operation: 'dust.runAgent',
        writeRequested: false,
        toolAuditPresent: true,
      },
    });
    expect(missingGateway.statusCode).toBe(200);
    expect(missingGateway.json()).toMatchObject({
      allowed: false,
      status: 'not_configured',
      activeConfigVersionId: null,
    });

    await publishHighRiskConfig({
      configType: 'dust_mcp_gateway',
      configKey: runtimeKey,
      configJson: {
        dustEnabled: true,
        mcpEnabled: false,
        writeMode: 'draft_only',
        secretRefs: ['dust-prod'],
        requireToolAudit: true,
      },
      changeReason: 'publish executable dust gateway runtime policy',
    });

    const missingAuditGateway = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/runtime-policy/dust-mcp-gateway/${runtimeKey}/check`,
      payload: {
        environment: 'dev',
        operation: 'dust.runAgent',
        writeRequested: false,
        toolAuditPresent: false,
      },
    });
    expect(missingAuditGateway.statusCode).toBe(200);
    expect(missingAuditGateway.json()).toMatchObject({ allowed: false, status: 'denied' });

    const blockedWriteGateway = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/runtime-policy/dust-mcp-gateway/${runtimeKey}/check`,
      payload: {
        environment: 'dev',
        operation: 'dust.upsertDocument',
        writeRequested: true,
        toolAuditPresent: true,
      },
    });
    expect(blockedWriteGateway.statusCode).toBe(200);
    expect(blockedWriteGateway.json()).toMatchObject({ allowed: false, status: 'denied' });

    const allowedGateway = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/runtime-policy/dust-mcp-gateway/${runtimeKey}/check`,
      payload: {
        environment: 'dev',
        operation: 'dust.runAgent',
        writeRequested: false,
        toolAuditPresent: true,
      },
    });
    expect(allowedGateway.statusCode).toBe(200);
    expect(allowedGateway.json()).toMatchObject({
      allowed: true,
      status: 'allowed',
      subject: 'dust.runAgent',
    });

    const missingRetrieval = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/runtime-policy/retrieval/${runtimeKey}/check`,
      payload: {
        environment: 'dev',
        operation: 'retrieval.embedReference',
        requestedChunks: 1,
        sourceBacked: true,
        expectedConfidence: 1,
      },
    });
    expect(missingRetrieval.statusCode).toBe(200);
    expect(missingRetrieval.json()).toMatchObject({
      allowed: false,
      status: 'not_configured',
      activeConfigVersionId: null,
    });

    await publishConfig({
      configType: 'retrieval',
      configKey: runtimeKey,
      configJson: {
        enabled: true,
        requireGroundedSources: true,
        minimumConfidence: 0.72,
        maxChunks: 8,
        noSourceBehavior: 'say_uncertain',
      },
      changeReason: 'publish executable retrieval runtime policy',
    });

    const tooManyChunks = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/runtime-policy/retrieval/${runtimeKey}/check`,
      payload: {
        environment: 'dev',
        operation: 'retrieval.referenceSearch',
        requestedChunks: 9,
        sourceBacked: true,
        expectedConfidence: 1,
      },
    });
    expect(tooManyChunks.statusCode).toBe(200);
    expect(tooManyChunks.json()).toMatchObject({ allowed: false, status: 'denied' });

    const ungroundedRetrieval = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/runtime-policy/retrieval/${runtimeKey}/check`,
      payload: {
        environment: 'dev',
        operation: 'retrieval.referenceSearch',
        requestedChunks: 3,
        sourceBacked: false,
        expectedConfidence: 1,
      },
    });
    expect(ungroundedRetrieval.statusCode).toBe(200);
    expect(ungroundedRetrieval.json()).toMatchObject({ allowed: false, status: 'denied' });

    const allowedRetrieval = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/runtime-policy/retrieval/${runtimeKey}/check`,
      payload: {
        environment: 'dev',
        operation: 'retrieval.referenceSearch',
        requestedChunks: 3,
        sourceBacked: true,
        expectedConfidence: 0.9,
      },
    });
    expect(allowedRetrieval.statusCode).toBe(200);
    expect(allowedRetrieval.json()).toMatchObject({
      allowed: true,
      status: 'allowed',
      subject: 'retrieval.referenceSearch',
    });

    const missingPromptPolicy = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/runtime-policy/prompt-library/${runtimeKey}/check`,
      payload: {
        environment: 'dev',
        operation: 'rfp.sectionDraft',
        promptSet: 'rfp-draft',
        versionedPrompt: true,
        injectionTested: true,
      },
    });
    expect(missingPromptPolicy.statusCode).toBe(200);
    expect(missingPromptPolicy.json()).toMatchObject({
      allowed: false,
      status: 'not_configured',
      activeConfigVersionId: null,
    });

    await publishHighRiskConfig({
      configType: 'prompt_library',
      configKey: runtimeKey,
      configJson: {
        versionedPromptsRequired: true,
        promptInjectionTestsRequired: true,
        approvalRequiredForProduction: true,
        allowedPromptSets: ['rfp-draft', 'rfp-extractor'],
      },
      changeReason: 'publish executable prompt library runtime policy',
    });

    const disallowedPromptSet = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/runtime-policy/prompt-library/${runtimeKey}/check`,
      payload: {
        environment: 'dev',
        operation: 'rfp.legalScan',
        promptSet: 'rfp-legal',
        versionedPrompt: true,
        injectionTested: true,
      },
    });
    expect(disallowedPromptSet.statusCode).toBe(200);
    expect(disallowedPromptSet.json()).toMatchObject({ allowed: false, status: 'denied' });

    const untestedPrompt = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/runtime-policy/prompt-library/${runtimeKey}/check`,
      payload: {
        environment: 'dev',
        operation: 'rfp.sectionDraft',
        promptSet: 'rfp-draft',
        versionedPrompt: true,
        injectionTested: false,
      },
    });
    expect(untestedPrompt.statusCode).toBe(200);
    expect(untestedPrompt.json()).toMatchObject({ allowed: false, status: 'denied' });

    const allowedPrompt = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/runtime-policy/prompt-library/${runtimeKey}/check`,
      payload: {
        environment: 'dev',
        operation: 'rfp.sectionDraft',
        promptSet: 'rfp-draft',
        versionedPrompt: true,
        injectionTested: true,
      },
    });
    expect(allowedPrompt.statusCode).toBe(200);
    expect(allowedPrompt.json()).toMatchObject({
      allowed: true,
      status: 'allowed',
      subject: 'rfp.sectionDraft:rfp-draft',
    });

    const missingEvalsPolicy = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/runtime-policy/evals-quality-gates/${runtimeKey}/check`,
      payload: {
        environment: 'dev',
        operation: 'eval.releaseGate',
        suite: 'rfp_proposal_quality',
        passRate: 1,
        failedCount: 0,
      },
    });
    expect(missingEvalsPolicy.statusCode).toBe(200);
    expect(missingEvalsPolicy.json()).toMatchObject({
      allowed: false,
      status: 'not_configured',
      activeConfigVersionId: null,
    });

    await publishHighRiskConfig({
      configType: 'evals_quality_gates',
      configKey: runtimeKey,
      configJson: {
        requiredBeforePublish: true,
        minimumPassRate: 0.98,
        regressionSuites: ['rfp_proposal_quality', 'prompt_injection'],
        blockOnFailure: true,
      },
      changeReason: 'publish executable eval quality gate policy',
    });

    const disallowedSuite = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/runtime-policy/evals-quality-gates/${runtimeKey}/check`,
      payload: {
        environment: 'dev',
        operation: 'eval.releaseGate',
        suite: 'unreviewed_eval_suite',
        passRate: 1,
        failedCount: 0,
      },
    });
    expect(disallowedSuite.statusCode).toBe(200);
    expect(disallowedSuite.json()).toMatchObject({ allowed: false, status: 'denied' });

    const failedEvalSuite = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/runtime-policy/evals-quality-gates/${runtimeKey}/check`,
      payload: {
        environment: 'dev',
        operation: 'eval.releaseGate',
        suite: 'rfp_proposal_quality',
        passRate: 0.99,
        failedCount: 1,
      },
    });
    expect(failedEvalSuite.statusCode).toBe(200);
    expect(failedEvalSuite.json()).toMatchObject({ allowed: false, status: 'denied' });

    const underThresholdEvalSuite = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/runtime-policy/evals-quality-gates/${runtimeKey}/check`,
      payload: {
        environment: 'dev',
        operation: 'eval.releaseGate',
        suite: 'rfp_proposal_quality',
        passRate: 0.97,
        failedCount: 0,
      },
    });
    expect(underThresholdEvalSuite.statusCode).toBe(200);
    expect(underThresholdEvalSuite.json()).toMatchObject({ allowed: false, status: 'denied' });

    const allowedEvalSuite = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/runtime-policy/evals-quality-gates/${runtimeKey}/check`,
      payload: {
        environment: 'dev',
        operation: 'eval.releaseGate',
        suite: 'rfp_proposal_quality',
        passRate: 1,
        failedCount: 0,
      },
    });
    expect(allowedEvalSuite.statusCode).toBe(200);
    expect(allowedEvalSuite.json()).toMatchObject({
      allowed: true,
      status: 'allowed',
      subject: 'eval.releaseGate:rfp_proposal_quality',
    });
  });

  skipIfNoDb('persists versioned config drafts, publish, rollback, and audit trail', async () => {
    const statusSignalCutoff = Date.now() - 1000;
    const empty = await server.inject({
      method: 'GET',
      url: `/api/v1/serum/configs/general/${configKey}?environment=dev`,
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.headers['cache-control']).toBe('no-store');
    expect(empty.json()).toMatchObject({ active: null, draft: null, versions: [], auditTrail: [] });

    const secretRejected = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/configs/general/${configKey}/draft`,
      payload: {
        environment: 'dev',
        configJson: { provider: { apiKey: 'sk-do-not-store' } },
        changeReason: 'prove raw secret guard',
      },
    });
    expect(secretRejected.statusCode).toBe(400);

    const firstDraft = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/configs/general/${configKey}/draft`,
      payload: {
        environment: 'dev',
        configJson: {
          safeMode: true,
          actionMode: 'read_only',
          provider: { secretRef: 'vault://agent-provider/openai' },
        },
        changeReason: 'create governed SERUM general draft',
      },
    });
    expect(firstDraft.statusCode).toBe(200);
    const firstDraftBody = firstDraft.json() as { id: string; version: number; status: string };
    expect(firstDraftBody).toMatchObject({ version: 1, status: 'draft' });

    const firstPublish = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/configs/${firstDraftBody.id}/publish`,
      payload: { changeReason: 'publish first controlled SERUM config' },
    });
    expect(firstPublish.statusCode).toBe(200);
    const firstActive = firstPublish.json() as {
      id: string;
      status: string;
      approvedByUserId: string | null;
      activatedAt: string | null;
    };
    expect(firstActive.status).toBe('active');
    expect(firstActive.approvedByUserId).toEqual(expect.any(String));
    expect(firstActive.activatedAt).toEqual(expect.any(String));

    const secondDraft = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/configs/general/${configKey}/draft`,
      payload: {
        environment: 'dev',
        configJson: { safeMode: false, actionMode: 'draft_write' },
        changeReason: 'create second governed SERUM general draft',
      },
    });
    expect(secondDraft.statusCode).toBe(200);
    const secondDraftBody = secondDraft.json() as { id: string; version: number };
    expect(secondDraftBody.version).toBe(2);

    const secondPublish = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/configs/${secondDraftBody.id}/publish`,
      payload: { changeReason: 'publish second controlled SERUM config' },
    });
    expect(secondPublish.statusCode).toBe(200);
    expect((secondPublish.json() as { status: string }).status).toBe('active');

    const rollback = await server.inject({
      method: 'POST',
      url: `/api/v1/serum/configs/${firstActive.id}/rollback`,
      payload: { changeReason: 'rollback to first safe-mode SERUM config' },
    });
    expect(rollback.statusCode).toBe(200);
    const rollbackBody = rollback.json() as {
      version: number;
      status: string;
      rollbackOfConfigVersionId: string | null;
      configJson: { safeMode?: boolean };
    };
    expect(rollbackBody).toMatchObject({
      version: 3,
      status: 'active',
      rollbackOfConfigVersionId: firstActive.id,
      configJson: { safeMode: true },
    });

    const snapshot = await server.inject({
      method: 'GET',
      url: `/api/v1/serum/configs/general/${configKey}?environment=dev`,
    });
    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.headers['cache-control']).toBe('no-store');
    const snapshotBody = snapshot.json() as {
      active: { id: string; version: number };
      versions: { status: string }[];
      auditTrail: { action: string; targetId: string | null }[];
    };
    expect(snapshotBody.active.version).toBe(3);
    expect(snapshotBody.versions.map((version) => version.status)).toContain('rolled_back');
    expect(snapshotBody.auditTrail.map((entry) => entry.action)).toEqual(
      expect.arrayContaining([
        'serum_config.draft.create',
        'serum_config.publish',
        'serum_config.rollback',
      ]),
    );
    expect(snapshotBody.auditTrail.every((entry) => entry.targetId)).toBe(true);

    const auditCount = await prisma.auditLog.count({
      where: {
        orgId,
        targetType: 'serum_config_version',
        action: { in: ['serum_config.draft.create', 'serum_config.publish', 'serum_config.rollback'] },
        at: { gte: new Date(Date.now() - 60_000) },
      },
    });
    expect(auditCount).toBeGreaterThanOrEqual(5);

    const statusAfterConfigChanges = await server.inject({
      method: 'GET',
      url: '/api/v1/serum/status',
    });
    expect(statusAfterConfigChanges.statusCode).toBe(200);
    const statusBody = statusAfterConfigChanges.json() as {
      summary: { latestConfigChangeAt: string | null };
    };
    expect(statusBody.summary.latestConfigChangeAt).toEqual(expect.any(String));
    expect(new Date(statusBody.summary.latestConfigChangeAt!).getTime()).toBeGreaterThanOrEqual(
      statusSignalCutoff,
    );
  });
});
