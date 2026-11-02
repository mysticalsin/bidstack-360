// Auto-push helpers: fire-and-forget CRM → Dust sync after mutations.
// These are designed to be called from route handlers after a successful
// Prisma write. They never throw — failures are logged and silently dropped
// so the user's API request is never blocked by a Dust outage.
// Transient errors (429, 502, 503, network) are retried up to 3 times with
// exponential backoff before giving up.

import { prisma } from '@bidstack/db';
import pino from 'pino';

import { getOrgDust } from './dust-credentials.js';

const log = pino({ name: 'dust-push', level: process.env.LOG_LEVEL ?? 'info' });

/** Retry an async operation with exponential backoff on transient errors.
 *  Transient = HTTP 429 / 502 / 503 or a network-level failure (no status).
 *  4xx codes other than 429 are permanent; they are not retried. */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 1_000,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status =
        err != null && typeof err === 'object' && 'status' in err
          ? (err as { status: unknown }).status
          : err != null && typeof err === 'object' && 'statusCode' in err
            ? (err as { statusCode: unknown }).statusCode
            : undefined;

      const isTransient =
        typeof status !== 'number' || // network error or unknown
        status === 429 || // rate limited
        status === 502 || // bad gateway
        status === 503; // service unavailable

      if (!isTransient || attempt === maxAttempts) throw err;

      const delay = baseDelayMs * 2 ** (attempt - 1);
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
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

/** Push an opportunity to Dust. Called after create or update.
 *  orgId is required so the lookup stays org-scoped and respects multi-tenancy. */
export async function pushOpportunityToDust(oppId: string, orgId: string): Promise<void> {
  const { client: dust, creds } = await getOrgDust(orgId, log);
  if (!dust || !creds?.dataSourceId) return; // a data source is required to push documents

  try {
    const opp = await prisma.opportunity.findUnique({ where: { id: oppId, orgId } });
    if (!opp) return;

    const documentId = `bidstack-deal-${opp.code}`;
    const text = serializeOpportunityToMarkdown(opp);

    // WHY withRetry: Dust API occasionally returns 429/503 under load.
    // Without retries, transient blips silently break the sync and the
    // document never reaches the knowledge base. Three attempts with
    // exponential backoff (1 s, 2 s, 4 s) cover the vast majority of
    // transient failures while staying well within the 10 s handler timeout.
    await withRetry(() =>
      dust.upsertDocument(creds.dataSourceId!, documentId, text, {
        opportunity_code: opp.code,
        opportunity_name: opp.name,
        customer_name: opp.customer,
        org_id: opp.orgId,
      }),
    );

    await prisma.opportunity.update({
      where: { id: opp.id, orgId: opp.orgId },
      data: { dustDocId: documentId, dustLastPushedAt: new Date() },
    });
  } catch (err) {
    // Fail open — don't block the API request.
    log.error({ err }, '[dust-push] opportunity failed');
  }
}

/** Push a lead to Dust. Called after create or update.
 *  orgId is required so the lookup stays org-scoped and respects multi-tenancy. */
export async function pushLeadToDust(leadId: string, orgId: string): Promise<void> {
  const { client: dust, creds } = await getOrgDust(orgId, log);
  if (!dust || !creds?.dataSourceId) return; // a data source is required to push documents

  try {
    const lead = await prisma.lead.findUnique({ where: { id: leadId, orgId } });
    if (!lead) return;

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

    await withRetry(() =>
      dust.upsertDocument(creds.dataSourceId!, documentId, text, {
        lead_email: lead.email ?? '',
        lead_first_name: lead.firstName,
        lead_last_name: lead.lastName,
        company_name: lead.companyName,
        org_id: lead.orgId,
      }),
    );

    await prisma.lead.update({
      where: { id: lead.id, orgId: lead.orgId },
      data: { dustDocId: documentId, dustLastPushedAt: new Date() },
    });
  } catch (err) {
    log.error({ err }, '[dust-push] lead failed');
  }
}
