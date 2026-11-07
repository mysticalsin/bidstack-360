/**
 * Retention per data class (GDPR Art. 5(1)(e) storage limitation).
 *
 * Each class names the env var that sets its period in days. A missing, zero,
 * negative or non-numeric value falls back to the default, so a typo can never
 * shorten retention to nothing. RETENTION_MODE=enforce is required before the
 * scheduled sweep deletes anything; any other value only reports.
 *
 * Deletes and scrubs run as raw SQL in bounded batches: the soft-delete
 * middleware would turn a delete of personal data into a soft delete that keeps
 * the data. Table and column names are constants below, never input.
 */
import { Prisma, type PrismaClient } from '../../generated/client/index.js';

export type RetentionMode = 'report' | 'enforce';

export interface RetentionPolicy {
  dataClass: string;
  envVar: string;
  defaultDays: number;
  /** delete = remove the row; scrub = null the personal columns, keep the record. */
  action: 'delete' | 'scrub';
  table: string;
  /** SQL expression for the row's age reference. */
  ageExpr: string;
  /** Extra condition that selects rows still holding the data (scrub classes). */
  pending?: string;
  /** SET clause for scrub classes. */
  scrub?: string;
  description: string;
}

export const RETENTION_POLICIES: readonly RetentionPolicy[] = [
  {
    dataClass: 'email_messages',
    envVar: 'RETENTION_EMAIL_MESSAGES_DAYS',
    defaultDays: 730,
    action: 'delete',
    table: 'email_messages',
    ageExpr: 'coalesce(received_at, sent_at, created_at)',
    description: 'Synced and sent email (bodies, recipients). Tracking pixels cascade.',
  },
  {
    dataClass: 'sms_messages',
    envVar: 'RETENTION_SMS_MESSAGES_DAYS',
    defaultDays: 730,
    action: 'delete',
    table: 'sms_messages',
    ageExpr: 'coalesce(sent_at, created_at)',
    description: 'SMS bodies and phone numbers. Opt-out records (sms_consents) are kept.',
  },
  {
    dataClass: 'calendar_events',
    envVar: 'RETENTION_CALENDAR_EVENTS_DAYS',
    defaultDays: 730,
    action: 'delete',
    table: 'calendar_events',
    ageExpr: 'end_at',
    description: 'Synced calendar events with attendee lists.',
  },
  {
    dataClass: 'call_transcripts',
    envVar: 'RETENTION_CALL_TRANSCRIPTS_DAYS',
    defaultDays: 365,
    action: 'scrub',
    table: 'call_sessions',
    ageExpr: 'coalesce(ended_at, created_at)',
    pending: 'transcript_text IS NOT NULL OR transcript_structured IS NOT NULL OR recording_url IS NOT NULL',
    scrub: 'transcript_text = NULL, transcript_structured = NULL, recording_url = NULL',
    description: 'Call transcripts and recording links. The call record and summary stay.',
  },
  {
    dataClass: 'meeting_transcripts',
    envVar: 'RETENTION_MEETING_TRANSCRIPTS_DAYS',
    defaultDays: 365,
    action: 'scrub',
    table: 'meeting_intel',
    ageExpr: 'held_at',
    pending: 'transcript_text IS NOT NULL',
    scrub: 'transcript_text = NULL',
    description: 'Meeting intel transcripts. Summaries and extracted next steps stay.',
  },
  {
    dataClass: 'kam_transcripts',
    envVar: 'RETENTION_KAM_TRANSCRIPTS_DAYS',
    defaultDays: 365,
    action: 'scrub',
    table: 'kam_sessions',
    ageExpr: 'held_at',
    pending: 'transcript_text IS NOT NULL OR transcript_structured IS NOT NULL',
    scrub: 'transcript_text = NULL, transcript_structured = NULL',
    description: 'Account management session transcripts. The approved AI note stays.',
  },
  {
    dataClass: 'meeting_ingest_payloads',
    envVar: 'RETENTION_MEETING_INGEST_DAYS',
    defaultDays: 90,
    action: 'delete',
    table: 'meeting_ingest_items',
    ageExpr: 'coalesce(processed_at, received_at)',
    description: 'Raw meeting payloads from connected sources, after processing.',
  },
  {
    dataClass: 'intel_evidence',
    envVar: 'RETENTION_INTEL_EVIDENCE_DAYS',
    defaultDays: 1095,
    action: 'delete',
    table: 'intel_evidence',
    ageExpr: 'fetched_at',
    description: 'Public-source excerpts behind account intel (3 years after fetch, per the schema note).',
  },
  {
    dataClass: 'notifications',
    envVar: 'RETENTION_NOTIFICATIONS_DAYS',
    defaultDays: 180,
    action: 'delete',
    table: 'notifications',
    ageExpr: 'created_at',
    description: 'In-app notifications (may name contacts).',
  },
  {
    dataClass: 'voice_commands',
    envVar: 'RETENTION_VOICE_COMMANDS_DAYS',
    defaultDays: 90,
    action: 'delete',
    table: 'voice_command_logs',
    ageExpr: 'created_at',
    description: 'Staff voice command transcripts.',
  },
  {
    dataClass: 'data_subject_requests',
    envVar: 'RETENTION_DATA_SUBJECT_REQUESTS_DAYS',
    defaultDays: 1095,
    action: 'delete',
    table: 'data_subject_requests',
    ageExpr: 'created_at',
    description: 'Data subject request ledger (counts only). The audit log keeps the event.',
  },
];

type Env = Record<string, string | undefined>;

export interface ResolvedPolicy extends RetentionPolicy {
  days: number;
}

export interface RetentionConfig {
  mode: RetentionMode;
  policies: ResolvedPolicy[];
}

function positiveDays(raw: string | undefined, fallback: number): number {
  if (!raw || !/^\d+$/.test(raw.trim())) return fallback;
  const n = Number(raw.trim());
  return n > 0 ? n : fallback;
}

export function resolveRetentionConfig(env: Env): RetentionConfig {
  return {
    mode: env.RETENTION_MODE === 'enforce' ? 'enforce' : 'report',
    policies: RETENTION_POLICIES.map((p) => ({ ...p, days: positiveDays(env[p.envVar], p.defaultDays) })),
  };
}

export interface RetentionClassResult {
  dataClass: string;
  envVar: string;
  days: number;
  action: 'delete' | 'scrub';
  cutoff: string;
  rows: number;
}

export interface RetentionSweepReport {
  mode: RetentionMode;
  dryRun: boolean;
  orgId: string | null;
  generatedAt: string;
  classes: RetentionClassResult[];
}

const BATCH = 5_000;
const MAX_BATCHES = 200;

export interface RetentionSweepOptions {
  dryRun: boolean;
  /** Restrict to one tenant (admin report). Omit for the platform-wide sweep. */
  orgId?: string;
  env?: Env;
  now?: Date;
}

/**
 * Count (dry run) or remove/scrub (enforce) rows past each class's period.
 * `rows` is the number that would be or was affected.
 */
export async function runRetentionSweep(
  db: PrismaClient,
  opts: RetentionSweepOptions,
): Promise<RetentionSweepReport> {
  const cfg = resolveRetentionConfig(opts.env ?? process.env);
  const now = opts.now ?? new Date();
  const classes: RetentionClassResult[] = [];

  for (const p of cfg.policies) {
    const cutoff = new Date(now.getTime() - p.days * 86_400_000);
    const table = Prisma.raw(`"${p.table}"`);
    const where = Prisma.sql`${Prisma.raw(p.ageExpr)} < ${cutoff}
      ${opts.orgId ? Prisma.sql`AND org_id = ${opts.orgId}::uuid` : Prisma.empty}
      ${p.pending ? Prisma.sql`AND (${Prisma.raw(p.pending)})` : Prisma.empty}`;

    let rows = 0;
    if (opts.dryRun) {
      const [r] = await db.$queryRaw<Array<{ n: bigint }>>(
        Prisma.sql`SELECT count(*) AS n FROM ${table} WHERE ${where}`,
      );
      rows = Number(r?.n ?? 0);
    } else {
      for (let i = 0; i < MAX_BATCHES; i += 1) {
        const batch = Prisma.sql`ctid IN (SELECT ctid FROM ${table} WHERE ${where} LIMIT ${BATCH})`;
        const n =
          p.action === 'delete'
            ? await db.$executeRaw(Prisma.sql`DELETE FROM ${table} WHERE ${batch}`)
            : await db.$executeRaw(
                Prisma.sql`UPDATE ${table} SET ${Prisma.raw(p.scrub ?? '')} WHERE ${batch}`,
              );
        rows += n;
        if (n < BATCH) break;
      }
    }
    classes.push({
      dataClass: p.dataClass,
      envVar: p.envVar,
      days: p.days,
      action: p.action,
      cutoff: cutoff.toISOString(),
      rows,
    });
  }

  return {
    mode: cfg.mode,
    dryRun: opts.dryRun,
    orgId: opts.orgId ?? null,
    generatedAt: now.toISOString(),
    classes,
  };
}
