/**
 * Import enrichment (slice 14): after a CSV or HubSpot chunk commits, every
 * company it created gets one full-refresh job (public sources, plus Apollo
 * organization data when configured) and joins the import's progress batch.
 * Idempotent: the batch merges ids per migration job and each job id is
 * stable, so a retried chunk queues nothing twice. Fail-open: a queue error
 * never fails the import; Refresh on the company page covers the gap.
 * Off when ACCOUNT_INTEL_IMPORT_ENRICH=false.
 */
import { openImportBatch, prisma } from '@bidstack/db';

import type { FullRefreshQueueJob } from './full-refresh.js';

export interface IntelEnqueueJob {
  data: FullRefreshQueueJob;
  jobId: string;
}

/** One job per company and batch; BullMQ drops a second add with the same id. */
export function importIntelJobId(orgId: string, batchId: string, companyId: string): string {
  return `${orgId}--import-intel--${batchId}--${companyId}`;
}

export function importEnrichEnabled(env: Record<string, string | undefined>): boolean {
  return env.ACCOUNT_INTEL_IMPORT_ENRICH !== 'false';
}

/** Open or extend the batch and queue one refresh per created company. */
export async function queueImportEnrichment(
  args: {
    orgId: string;
    userId: string | null;
    migrationJobId: string;
    origin: 'csv' | 'hubspot';
    companyIds: string[];
    env: Record<string, string | undefined>;
    enqueue: (jobs: IntelEnqueueJob[]) => Promise<void>;
  },
  log: { warn: (obj: object, msg: string) => void },
): Promise<{ batchId: string | null; queued: number }> {
  const ids = [...new Set(args.companyIds)];
  if (!ids.length || !importEnrichEnabled(args.env)) return { batchId: null, queued: 0 };
  try {
    const user = args.userId ? await prisma.user.findFirst({ where: { id: args.userId, orgId: args.orgId }, select: { id: true } }) : null;
    const batchId = await openImportBatch(prisma, { orgId: args.orgId, migrationJobId: args.migrationJobId, origin: args.origin, companyIds: ids, createdById: user?.id ?? null });
    const jobs = ids.map((companyId) => ({
      data: { kind: 'full-refresh' as const, orgId: args.orgId, companyId, batchId, force: false, requestedBy: user?.id ?? null },
      jobId: importIntelJobId(args.orgId, batchId, companyId),
    }));
    await args.enqueue(jobs);
    return { batchId, queued: jobs.length };
  } catch (err) {
    log.warn({ orgId: args.orgId, migrationJobId: args.migrationJobId, err: (err as Error).message }, 'import enrichment not queued');
    return { batchId: null, queued: 0 };
  }
}
