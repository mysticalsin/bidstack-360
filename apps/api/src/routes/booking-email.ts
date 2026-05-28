/**
 * Pure builder functions for the booking confirmation email.
 * Extracted so they can be unit-tested without any server / DB dependency.
 *
 * WHY separate file: the HTML / text builders are the highest-risk surface
 * (template correctness, XSS injection, date/time formatting), so they
 * deserve their own test coverage. Keeping them in bookings.ts (which has
 * many router dependencies) would make unit-testing them difficult.
 */

export interface BookingEmailParams {
  orgId: string;
  userId: string;
  attendeeName: string;
  attendeeEmail: string;
  ownerName: string | null;
  pageName: string;
  startAt: Date;
  endAt: Date;
  bookingId: string;
  cancelToken: string;
}

type TemplateParams = BookingEmailParams & {
  greeting: string;
  organizer: string;
  cancelUrl: string;
};

export function buildBookingConfirmationHtml(p: TemplateParams): string {
  const dateStr = p.startAt.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const startTime = p.startAt.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  });
  const endTime = p.endAt.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  });

  // WHY table-based layout: many email clients still use Word's rendering engine
  // and strip CSS. Tables + inline styles are the only reliable cross-client
  // layout primitive. Apple HIG: #0071e3 blue, 16px border-radius, 8px grid.
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;font-family:system-ui,-apple-system,sans-serif;background:#f5f5f7">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;padding:48px 40px;max-width:560px">
        <tr><td>
          <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#0071e3;text-transform:uppercase;letter-spacing:0.06em">Confirmed</p>
          <h1 style="margin:0 0 24px;font-size:24px;font-weight:700;color:#1d1d1f;letter-spacing:-0.02em">${escapeHtml(p.pageName)}</h1>
          <p style="margin:0 0 8px;font-size:15px;color:#1d1d1f">${escapeHtml(p.greeting)}</p>
          <p style="margin:0 0 28px;font-size:15px;color:#1d1d1f;line-height:1.6">
            Your booking with <strong>${escapeHtml(p.organizer)}</strong> is confirmed.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;border-radius:12px;padding:20px 24px;margin-bottom:28px">
            <tr>
              <td style="font-size:13px;color:#6e6e73;padding-bottom:8px">Date</td>
              <td style="font-size:15px;font-weight:600;color:#1d1d1f;text-align:right;padding-bottom:8px">${dateStr}</td>
            </tr>
            <tr>
              <td style="font-size:13px;color:#6e6e73">Time</td>
              <td style="font-size:15px;font-weight:600;color:#1d1d1f;text-align:right">${startTime} – ${endTime}</td>
            </tr>
          </table>
          <p style="margin:0 0 8px;font-size:13px;color:#6e6e73">
            Need to cancel? Use the link below — no account required.
          </p>
          <a href="${escapeHtml(p.cancelUrl)}" style="font-size:13px;color:#6e6e73">${escapeHtml(p.cancelUrl)}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildBookingConfirmationText(p: TemplateParams): string {
  const dateStr = p.startAt.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const startTime = p.startAt.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  });
  const endTime = p.endAt.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  });
  return [
    p.greeting,
    '',
    `Your booking "${p.pageName}" with ${p.organizer} is confirmed.`,
    '',
    `Date: ${dateStr}`,
    `Time: ${startTime} – ${endTime}`,
    '',
    'To cancel your booking, visit:',
    p.cancelUrl,
  ].join('\n');
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Minimal HTML escaping for user-supplied strings inserted into the template.
 * WHY: attendeeName and pageName come from form input; escaping prevents a
 * name like `<script>` from breaking the email body in clients that render
 * raw HTML. (In practice Zod's max-length check limits the damage, but
 * defense-in-depth applies here.)
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
