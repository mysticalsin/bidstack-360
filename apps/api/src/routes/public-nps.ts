/**
 * Public NPS response page — server-rendered HTML, no auth.
 *
 * Flow:
 *   1. Email contains link → https://app.bidstack.com/public/nps/<token>
 *   2. GET /public/nps/:token renders an 11-button score form (no JS required).
 *      Form posts to POST /public/nps/:token as application/x-www-form-urlencoded.
 *   3. POST handler validates token, persists response via nps.service, renders
 *      thank-you page. Any error renders a friendly error page.
 *
 * WHY pure HTML form (no JS):
 *   - Survives strict CSP (script-src 'self' — no inline scripts).
 *   - Works in mail clients that aggressively strip script.
 *   - Accessible by default — no a11y regressions from custom widgets.
 *   - Loads in <1s even on terrible connections.
 *
 * Security:
 *   - Token is HMAC-signed (see nps.service.ts). Hash lookup means even a stolen
 *     DB row doesn't reveal valid tokens.
 *   - All user-visible interpolation goes through escapeHtml() to block XSS.
 *   - skipAuth at the Fastify config level — explicit, audited bypass.
 */

import type { FastifyPluginAsync } from 'fastify';
import { recordNpsResponse } from '../services/cs/nps.service.js';

// ─── Escaping helper ──────────────────────────────────────────────────────

const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPE[ch] ?? ch);
}

// ─── HTML templates ────────────────────────────────────────────────────────

const PAGE_CSS = `
  :root {
    color-scheme: light dark;
    --bg: #ffffff; --fg: #0f172a; --muted: #64748b; --accent: #2563eb;
    --border: #e2e8f0; --button-bg: #f8fafc; --button-hover: #eff6ff;
    --error-bg: #fef2f2; --error-fg: #991b1b; --success-bg: #ecfdf5; --success-fg: #065f46;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f172a; --fg: #f1f5f9; --muted: #94a3b8; --accent: #60a5fa;
      --border: #334155; --button-bg: #1e293b; --button-hover: #334155;
      --error-bg: #450a0a; --error-fg: #fecaca; --success-bg: #022c22; --success-fg: #a7f3d0;
    }
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    background: var(--bg); color: var(--fg);
    margin: 0; padding: 1.5rem; line-height: 1.5;
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
  }
  main { max-width: 560px; width: 100%; }
  h1 { margin-top: 0; font-size: 1.5rem; font-weight: 600; }
  p.subtitle { color: var(--muted); margin-bottom: 2rem; }
  .scale {
    display: grid; grid-template-columns: repeat(11, minmax(0, 1fr));
    gap: 0.375rem; margin: 1.5rem 0 0.5rem;
  }
  .scale-label {
    display: flex; justify-content: space-between;
    font-size: 0.8125rem; color: var(--muted); margin-bottom: 1.5rem;
  }
  .score-btn {
    aspect-ratio: 1 / 1; min-height: 44px;
    border: 1px solid var(--border); background: var(--button-bg);
    border-radius: 0.5rem; font-size: 1rem; font-weight: 500;
    color: var(--fg); cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.15s, border-color 0.15s, transform 0.1s;
  }
  .score-btn:hover { background: var(--button-hover); border-color: var(--accent); }
  .score-btn:active { transform: scale(0.96); }
  .score-btn:focus-visible {
    outline: 2px solid var(--accent); outline-offset: 2px;
  }
  .score-btn input[type="radio"] { position: absolute; opacity: 0; pointer-events: none; }
  .score-btn:has(input:checked) {
    background: var(--accent); color: white; border-color: var(--accent);
  }
  textarea {
    width: 100%; min-height: 96px; padding: 0.75rem;
    border: 1px solid var(--border); background: var(--bg); color: var(--fg);
    border-radius: 0.5rem; font-family: inherit; font-size: 1rem;
    resize: vertical;
  }
  textarea:focus-visible {
    outline: 2px solid var(--accent); outline-offset: 2px;
  }
  label.field { display: block; margin-top: 1.5rem; font-weight: 500; }
  label.field > .help { display: block; font-weight: 400; color: var(--muted); margin: 0.25rem 0 0.5rem; font-size: 0.875rem; }
  button.submit {
    margin-top: 1.5rem; padding: 0.75rem 1.5rem; min-height: 44px;
    background: var(--accent); color: white; border: none;
    border-radius: 0.5rem; font-size: 1rem; font-weight: 600; cursor: pointer;
    width: 100%;
  }
  button.submit:hover { filter: brightness(1.1); }
  button.submit:focus-visible { outline: 2px solid var(--fg); outline-offset: 2px; }
  .alert {
    padding: 1rem; border-radius: 0.5rem; margin-bottom: 1.5rem;
  }
  .alert-error { background: var(--error-bg); color: var(--error-fg); }
  .alert-success { background: var(--success-bg); color: var(--success-fg); }
  @media (prefers-reduced-motion: reduce) {
    .score-btn, button.submit { transition: none; }
    .score-btn:active { transform: none; }
  }
`;

interface PageOpts {
  title: string;
  body: string;
}

function renderPage({ title, body }: PageOpts): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${escapeHtml(title)}</title>
  <style>${PAGE_CSS}</style>
</head>
<body>
  <main>${body}</main>
</body>
</html>`;
}

function renderForm(token: string, error?: string): string {
  const safeToken = escapeHtml(token);
  const buttons = Array.from({ length: 11 }, (_, i) => `
      <label class="score-btn">
        <input type="radio" name="score11" value="${i}" required>
        ${i}
      </label>`).join('');

  return renderPage({
    title: 'How likely are you to recommend us?',
    body: `
      <h1>How likely are you to recommend us?</h1>
      <p class="subtitle">
        Your feedback helps us improve. This survey takes about 30 seconds.
      </p>
      ${error ? `<div class="alert alert-error" role="alert">${escapeHtml(error)}</div>` : ''}
      <form method="POST" action="/api/public/nps/${safeToken}" novalidate>
        <fieldset style="border: 0; padding: 0; margin: 0;">
          <legend style="font-weight: 500;">
            On a scale of 0–10, how likely are you to recommend us to a colleague?
          </legend>
          <div class="scale" role="radiogroup" aria-label="Score from 0 to 10">
            ${buttons}
          </div>
          <div class="scale-label" aria-hidden="true">
            <span>Not at all likely</span>
            <span>Extremely likely</span>
          </div>
        </fieldset>
        <label class="field" for="feedback">
          What's the main reason for your score?
          <span class="help">Optional — but very helpful for us.</span>
        </label>
        <textarea
          id="feedback"
          name="feedback"
          maxlength="2000"
          placeholder="Tell us what we got right or what we should improve…"
        ></textarea>
        <button type="submit" class="submit">Submit feedback</button>
      </form>
    `,
  });
}

function renderThankYou(category: string): string {
  const headline =
    category === 'PROMOTER'
      ? 'Thank you — that means a lot.'
      : category === 'PASSIVE'
      ? 'Thank you for the honest feedback.'
      : 'Thank you — we hear you.';

  const message =
    category === 'PROMOTER'
      ? 'Would you mind sharing a quick review or telling a colleague? Word of mouth keeps us going.'
      : category === 'PASSIVE'
      ? "We'll review what you shared and reach out if there's anything specific we can improve."
      : 'Someone from our team will reach out within 2 business days to understand what we got wrong and how we can make it right.';

  return renderPage({
    title: 'Thank you',
    body: `
      <h1>${escapeHtml(headline)}</h1>
      <div class="alert alert-success" role="status">${escapeHtml(message)}</div>
      <p class="subtitle">You can close this page.</p>
    `,
  });
}

function renderError(headline: string, detail: string): string {
  return renderPage({
    title: headline,
    body: `
      <h1>${escapeHtml(headline)}</h1>
      <div class="alert alert-error" role="alert">${escapeHtml(detail)}</div>
      <p class="subtitle">
        If you believe this is a mistake, contact your account manager.
      </p>
    `,
  });
}

// ─── Plugin ────────────────────────────────────────────────────────────────

/**
 * Public NPS response routes — no auth, HTML responses.
 *
 * Mounted OUTSIDE the /api/v1 versioning prefix because the URL goes in emails
 * and must remain stable across API versions.
 */
export const publicNpsRoutes: FastifyPluginAsync = async (app) => {
  // Scoped urlencoded body parser — registered here, not globally, to limit blast radius.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => {
      try {
        const params = new URLSearchParams(body as string);
        const obj: Record<string, string> = {};
        for (const [k, v] of params.entries()) obj[k] = v;
        done(null, obj);
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  // ── GET /public/nps/:token ─────────────────────────────────────────────
  app.get<{ Params: { token: string } }>(
    '/public/nps/:token',
    { config: { skipAuth: true } },
    async (req, reply) => {
      const { token } = req.params;
      if (!token || token.length < 32 || token.length > 128) {
        return reply.code(400).type('text/html').send(
          renderError('Invalid survey link', "This link doesn't look right. Check the URL in your email.")
        );
      }
      return reply.type('text/html').send(renderForm(token));
    },
  );

  // ── POST /public/nps/:token ────────────────────────────────────────────
  app.post<{ Params: { token: string }; Body: Record<string, string> }>(
    '/public/nps/:token',
    { config: { skipAuth: true } },
    async (req, reply) => {
      const { token } = req.params;
      const body = req.body ?? {};

      // Validate score11
      const scoreRaw = body['score11'];
      const score11 = scoreRaw !== undefined ? Number.parseInt(scoreRaw, 10) : NaN;
      if (!Number.isInteger(score11) || score11 < 0 || score11 > 10) {
        return reply.code(400).type('text/html').send(
          renderForm(token, 'Please choose a score between 0 and 10.')
        );
      }

      const feedback = typeof body['feedback'] === 'string' && body['feedback'].trim()
        ? body['feedback'].trim().slice(0, 2000)
        : undefined;

      try {
        const result = await recordNpsResponse(
          { token, score11, feedback },
          req.log as never,
        );
        return reply.type('text/html').send(renderThankYou(result.category));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'An unexpected error occurred';
        if (message.includes('not found') || message.includes('invalid')) {
          return reply.code(404).type('text/html').send(
            renderError('Survey not found', "This link may have expired or been used already. If you have feedback to share, please email your account manager.")
          );
        }
        if (message.includes('expired')) {
          return reply.code(410).type('text/html').send(
            renderError('Survey expired', 'This survey link has expired. Please email your account manager if you still have feedback to share.')
          );
        }
        if (message.includes('already responded')) {
          return reply.code(409).type('text/html').send(
            renderError("You've already responded", 'Thanks — your previous response has been recorded.')
          );
        }
        req.log.error({ err }, 'public-nps: unexpected error recording response');
        return reply.code(500).type('text/html').send(
          renderError('Something went wrong', "We couldn't record your response. Please try again in a moment.")
        );
      }
    },
  );
};
