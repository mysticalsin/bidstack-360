/**
 * Audit log hash-chain verification.
 *
 * The chain is written by the audit_log_chain trigger (migration
 * 20261107070020_audit_log_hash_chain_triggers). Verification runs in SQL with the same
 * digest function, so the app never re-implements the canonical row format.
 * A row breaks the chain when its stored hash no longer matches its content
 * (tampering), when its prev_hash does not match the previous row's hash, or
 * when its sequence skips (a row was deleted from the middle).
 */
import { prisma } from '@bidstack/db';

export type AuditChainBreak = {
  id: string;
  chainSeq: string;
  reason: 'hash_mismatch' | 'link_mismatch' | 'sequence_gap';
};

export type AuditChainReport = {
  checked: number;
  firstSeq: string | null;
  lastSeq: string | null;
  ok: boolean;
  breaks: AuditChainBreak[];
};

const MAX_BREAKS = 20;

export async function verifyAuditChain(orgId: string): Promise<AuditChainReport> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: bigint;
      chain_seq: bigint;
      hash_ok: boolean;
      link_ok: boolean;
      seq_ok: boolean;
    }>
  >`
    WITH chain AS (
      SELECT a.id,
             a.chain_seq,
             a.row_hash = audit_log_row_digest(a.prev_hash, a) AS hash_ok,
             (lag(a.row_hash) OVER w IS NULL OR a.prev_hash = lag(a.row_hash) OVER w) AS link_ok,
             (lag(a.chain_seq) OVER w IS NULL OR a.chain_seq = lag(a.chain_seq) OVER w + 1) AS seq_ok
        FROM audit_log a
       WHERE a.org_id = ${orgId}::uuid AND a.chain_seq IS NOT NULL
      WINDOW w AS (ORDER BY a.chain_seq)
    )
    SELECT id, chain_seq, hash_ok, link_ok, seq_ok
      FROM chain
     WHERE NOT (hash_ok AND link_ok AND seq_ok)
     ORDER BY chain_seq
     LIMIT ${MAX_BREAKS}`;

  const [summary] = await prisma.$queryRaw<
    Array<{ checked: bigint; first_seq: bigint | null; last_seq: bigint | null }>
  >`
    SELECT count(*) AS checked, min(chain_seq) AS first_seq, max(chain_seq) AS last_seq
      FROM audit_log
     WHERE org_id = ${orgId}::uuid AND chain_seq IS NOT NULL`;

  const breaks = rows.map((r) => ({
    id: r.id.toString(),
    chainSeq: r.chain_seq.toString(),
    reason: !r.hash_ok
      ? ('hash_mismatch' as const)
      : !r.link_ok
        ? ('link_mismatch' as const)
        : ('sequence_gap' as const),
  }));

  return {
    checked: Number(summary?.checked ?? 0),
    firstSeq: summary?.first_seq?.toString() ?? null,
    lastSeq: summary?.last_seq?.toString() ?? null,
    ok: breaks.length === 0,
    breaks,
  };
}
