/**
 * Pure helpers for MSA renewal / expiry reminders (no DB, no clock).
 *
 * Expiry reminders fire at 90, 60 and 30 days before expiry. Like the bid
 * deadline alerts, only the NEAREST crossed boundary fires on a scan, so a
 * contract first seen 40 days out gets one "60 days" alert, not 90 and 60 at
 * once, and each boundary fires at most once per term.
 *
 * The notice reminder fires once when the notice deadline (expiry minus the
 * notice period) is within NOTICE_LEAD_DAYS and not yet passed: that is the
 * last date to send a termination or renegotiation notice.
 */

export const MSA_REMINDER_DAYS = [90, 60, 30] as const;
export type MsaReminderDay = (typeof MSA_REMINDER_DAYS)[number];

/** Longest notice period the API accepts (MsaCreate.noticePeriodDays). */
export const MSA_MAX_NOTICE_DAYS = 730;

/** How early the notice-deadline reminder fires. */
export const NOTICE_LEAD_DAYS = 14;

const DAY_MS = 86_400_000;

export type MsaReminderKind = `expiry-${MsaReminderDay}` | 'notice';

export interface MsaReminder {
  kind: MsaReminderKind;
  /** Days left until the date the reminder is about (expiry or notice deadline). */
  daysLeft: number;
  /** The date the reminder is about. */
  date: Date;
}

export function utcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((utcDay(to) - utcDay(from)) / DAY_MS);
}

export function nearestCrossedReminderDay(daysLeft: number): MsaReminderDay | null {
  if (daysLeft < 0) return null;
  const crossed = MSA_REMINDER_DAYS.filter((d) => daysLeft <= d);
  return crossed.length ? (Math.min(...crossed) as MsaReminderDay) : null;
}

export function dueReminders(
  contract: { expiryDate: Date | null; noticePeriodDays: number | null },
  now: Date,
): MsaReminder[] {
  if (!contract.expiryDate) return [];
  const out: MsaReminder[] = [];
  const daysLeft = daysBetween(now, contract.expiryDate);
  const day = nearestCrossedReminderDay(daysLeft);
  if (day !== null) out.push({ kind: `expiry-${day}`, daysLeft, date: contract.expiryDate });
  if (contract.noticePeriodDays != null && contract.noticePeriodDays > 0) {
    const deadline = new Date(utcDay(contract.expiryDate) - contract.noticePeriodDays * DAY_MS);
    const noticeLeft = daysBetween(now, deadline);
    if (noticeLeft >= 0 && noticeLeft <= NOTICE_LEAD_DAYS) {
      out.push({ kind: 'notice', daysLeft: noticeLeft, date: deadline });
    }
  }
  return out;
}

/**
 * Dedupe URL. The term (expiry date) is part of it, so a renewed contract with
 * a new expiry gets a fresh set of reminders. Matches the partial unique index
 * notifications_msa_reminder_dedupe_uq (url LIKE '/msa/%?reminder=%').
 */
export function msaReminderUrl(contractId: string, kind: MsaReminderKind, expiry: Date): string {
  return `/msa/${contractId}?reminder=${kind}&term=${expiry.toISOString().slice(0, 10)}`;
}

function inDays(n: number): string {
  if (n === 0) return 'today';
  if (n === 1) return 'in 1 day';
  return `in ${n} days`;
}

export function reminderCopy(
  c: { title: string; companyName: string | null; autoRenew: boolean },
  r: MsaReminder,
): { title: string; body: string } {
  const who = c.companyName ? `${c.companyName}: ` : '';
  const date = r.date.toISOString().slice(0, 10);
  if (r.kind === 'notice') {
    const action = c.autoRenew ? 'stop the automatic renewal or renegotiate' : 'send notice or renegotiate';
    return {
      title: `MSA notice deadline ${inDays(r.daysLeft)}: ${c.title}`,
      body: `${who}last day to ${action} is ${date}.`,
    };
  }
  const verb = c.autoRenew ? 'renews automatically' : 'expires';
  return {
    title: `MSA ${c.autoRenew ? 'renewal' : 'expiry'} ${inDays(r.daysLeft)}: ${c.title}`,
    body: `${who}"${c.title}" ${verb} on ${date}.`,
  };
}
