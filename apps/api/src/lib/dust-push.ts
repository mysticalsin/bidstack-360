// Auto-push helpers: fire-and-forget CRM → Dust sync after mutations.
// These are designed to be called from route handlers after a successful
// Prisma write. They never throw — failures are logged and silently dropped
// so the user's API request is never blocked by a Dust outage.

import { prisma } from '@bidstack/db';
import { DustClient } from '@bidstack/dust-client';
import pino from 'pino';

const log = pino({ name: 'dust-push', level: process.env.LOG_LEVEL ?? 'info' });

function getDustConfig() {
  const apiKey = process.env.DUST_API_KEY;
  const workspaceId = process.env.DUST_WORKSPACE_ID;
  const dataSourceId = process.env.DUST_DATA_SOURCE_ID;
  if (!apiKey || !workspaceId || !dataSourceId) return null;
  return { apiKey, workspaceId, dataSourceId };
}

function serializeOpportunityToMarkdown(opp: {
  name: string;
  code: string;
  customer: string;
  stage: string;
  valueMicros: bigint | number | unknown;
  probability: number;
  dueDate: Date | null;
  industry: string | null;
  intel: unknown;
}): string {
  const value =
    typeof opp.valueMicros === 'bigint'
      ? (Number(opp.valueMicros) / 1_000_000).toString()
      : typeof opp.valueMicros === 'number'
        ? (opp.valueMicros / 1_000_000).toString()
        : String(opp.valueMicros);

  return [
    `# ${opp.name}`,
    ``,
    `- **Code:** ${opp.code}`,
    `- **Customer:** ${opp.customer}`,
    `- **Stage:** ${opp.stage}`,
    `- **Value (EUR):** ${value}`,
    `- **Probability:** ${opp.probability}%`,
    `- **Due Date:** ${opp.dueDate?.toISOString() ?? 'N/A'}`,
    `- **Industry:** ${opp.industry ?? 'N/A'}`,
    ``,
    `## Intel`,
    ``,
    '```json',
    JSON.stringify(opp.intel, null, 2),
    '```',
  ].join('\n');
}

/** Push an opportunity to Dust. Called after create or update. */
export async function pushOpportunityToDust(oppId: string): Promise<void> {
  const cfg = getDustConfig();
  if (!cfg) return;

  try {
    const opp = await prisma.opportunity.findUnique({ where: { id: oppId } });
    if (!opp) return;

    const dust = new DustClient({
      apiKey: cfg.apiKey,
      workspaceId: cfg.workspaceId,
      timeoutMs: 10_000,
    });

    const documentId = `bidstack-deal-${opp.code}`;
    const text = serializeOpportunityToMarkdown(opp);

    await dust.upsertDocument(cfg.dataSourceId, documentId, text, {
      opportunity_code: opp.code,
      opportunity_name: opp.name,
      customer_name: opp.customer,
      org_id: opp.orgId,
    });

    await prisma.opportunity.update({
      where: { id: opp.id },
      data: { dustDocId: documentId, dustLastPushedAt: new Date() },
    });
  } catch (err) {
    // Fail open — don't block the API request.
    log.error({ err }, '[dust-push] opportunity failed');
  }
}

/** Push a lead to Dust. Called after create or update. */
export async function pushLeadToDust(leadId: string): Promise<void> {
  const cfg = getDustConfig();
  if (!cfg) return;

  try {
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) return;

    const dust = new DustClient({
      apiKey: cfg.apiKey,
      workspaceId: cfg.workspaceId,
      timeoutMs: 10_000,
    });

    const documentId = `bidstack-lead-${lead.id}`;
    const text = [
      `# ${lead.firstName} ${lead.lastName}`,
      ``,
      `- **Company:** ${lead.companyName}`,
      `- **Email:** ${lead.email ?? 'N/A'}`,
      `- **Phone:** ${lead.phone ?? 'N/A'}`,
      `- **Title:** ${lead.title ?? 'N/A'}`,
      `- **Status:** ${lead.status}`,
      `- **Priority:** ${lead.priority}`,
      `- **Score:** ${lead.score}`,
      `- **Source:** ${lead.source}`,
      ``,
      `## BANT`,
      `- Budget: ${lead.budget ?? 'N/A'}`,
      `- Authority: ${lead.authority ?? 'N/A'}`,
      `- Need: ${lead.need ?? 'N/A'}`,
      `- Timeline: ${lead.timeline ?? 'N/A'}`,
      ``,
      `## Notes`,
      lead.notes ?? '',
    ].join('\n');

    await dust.upsertDocument(cfg.dataSourceId, documentId, text, {
      lead_email: lead.email ?? '',
      lead_first_name: lead.firstName,
      lead_last_name: lead.lastName,
      company_name: lead.companyName,
      org_id: lead.orgId,
    });

    await prisma.lead.update({
      where: { id: lead.id },
      data: { dustDocId: documentId, dustLastPushedAt: new Date() },
    });
  } catch (err) {
    log.error({ err }, '[dust-push] lead failed');
  }
}
