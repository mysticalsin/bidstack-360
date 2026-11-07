// Pins the consent and safety copy listed in DESIGN.md section 9.5 (v3.0.0).
//
// Copy-cut passes remove taglines and helper text. These strings are legal,
// consent, privacy, AI-disclosure or destructive-action warnings, so they must
// survive every cut verbatim. Each one has to exist either as a value in an
// English locale file (public/locales/en/*.json) or as an inline default in
// apps/web/src. If a string moves, update the source, not this list; rewording
// one needs a DESIGN.md change and sign-off first.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

export const PINNED_CONSENT_COPY: readonly string[] = [
  // Signatures
  'Your signature is legally binding. This page contains no tracking technologies.',
  'I agree that this electronic signature is legally binding and represents my intent to sign this document. I have had the opportunity to review its contents.',
  '{{senderName}} has been notified. A copy of the signed document will be sent to your email address.',
  'I agree that this electronic signature is legally equivalent to my handwritten signature.',
  // SMS
  'This number has requested to stop receiving SMS. Sending is blocked (TCPA compliance).',
  'This message will be sent as {{count}} segments (billed per segment by Twilio).',
  // Secrets shown once
  'Copy the secret now \u2014 it will not be shown again.',
  "You'll see the secret exactly once \u2014 copy it before closing.",
  "Copy your new key now \u2014 it won't be shown again.",
  'Any client using this key will start failing immediately. This cannot be undone.',
  'Copy the signing secret now',
  'Store this secret in the receiver for',
  'It will not be shown again.',
  'Webhooks are limited to administrators',
  'Webhook subscriptions can push sensitive platform data to external systems, so only admins can view, create, test, pause, or delete them.',
  'The endpoint will stop receiving Polo PreSales events immediately. Delivery history is retained.',
  'Copy this token now. It is shown once and Polo keeps only its fingerprint.',
  // AI disclosure and review
  'AI-assisted draft \u2014 review before sending',
  'These are AI suggestions only. Review before applying to the deal.',
  'Open-web signal; verify before treating as a Mantu fact.',
  '{{label}} open-web feed checked at {{fetchedAt}} with {{confidence}}% source confidence. Verify before treating it as a Mantu fact.',
  'Source: Google News \u00b7 verify before treating as a Mantu fact.',
  'Human Review: Pre-Drafting Gate',
  'Extracted fields applied \u2014 review before saving',
  'Apply extracted fields (review before saving)',
  'Verify before staging',
  // Transcripts and data privacy
  'Show transcript (shared with consent)',
  'No transcript stored. Transcripts are kept only when a M\u00e9tis user opts in.',
  'No transcript is stored for manual entries.',
  'Data privacy:',
  'Model artifacts contain only learned weights \u2014 no raw deal data, names, or emails. Each org trains its own isolated model. Scores are cached for 1 hour in Redis and invalidated on record updates.',
  'Phone numbers and contact leads are not stored',
  'Secrets stay server-side. Add them to local/production env, then restart worker/API.',
  'Create read/write keys only for the exact workflow and keep secrets server-side.',
  'No secrets sent',
  'Raw API keys, passwords, credentials, and secrets are rejected server-side. Use secretRef fields.',
  'Enrichment falls back to free open data. The stored key is removed.',
  'Only admins can manage data-source keys.',
  // Governance
  'Standing decision: an opportunity with a recorded No-Go / No-Bid cannot advance until a positive gate or a justified override is on record.',
  // Destructive actions
  'This permanently removes "{{name}}". This cannot be undone.',
  'This permanently removes the proposal and all its sections. This cannot be undone.',
  'This will permanently delete the object definition and all records belonging to it. This action cannot be undone.',
  'This action cannot be undone.',
  'Delete all demonstration data? This action cannot be undone.',
  '"{{name}}" will be removed. This can\'t be undone.',
  '{{recordKey}} will be soft-deleted. It can be restored via the API.',
];

const WEB_ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

function collectJsonStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectJsonStrings(v, out));
  else if (value && typeof value === 'object') {
    Object.values(value).forEach((v) => collectJsonStrings(v, out));
  }
}

// Source text with comments dropped (a pin must ship, not sit in a comment) and
// JS string escapes and JSX line wrapping undone, so an inline default reads
// the same as the rendered string.
function normalizeSource(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\\u2014/g, '\u2014')
    .replace(/\\(['"`])/g, '$1')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ');
}

function buildCorpus(): { locale: string[]; source: string } {
  const localeDir = join(WEB_ROOT, 'public/locales/en');
  const locale: string[] = [];
  for (const file of readdirSync(localeDir).filter((f) => f.endsWith('.json'))) {
    collectJsonStrings(JSON.parse(readFileSync(join(localeDir, file), 'utf8')), locale);
  }
  const source = walk(join(WEB_ROOT, 'src'))
    .map((f) => normalizeSource(readFileSync(f, 'utf8')))
    .join('\n');
  return { locale, source };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The pin must start and end at a string or JSX-text boundary, so a short pin
// ("This action cannot be undone.") cannot pass by sitting inside a longer one.
function shipsAsWholeCopy(haystack: string, pinned: string): boolean {
  return new RegExp(`(?:^|['"\`>]) ?${escapeRe(pinned)} ?(?=$|['"\`<{])`, 'm').test(haystack);
}

describe('pinned consent and safety copy (DESIGN.md 9.5)', () => {
  const corpus = buildCorpus();
  const localeText = corpus.locale.map((s) => `"${s.replace(/\s+/g, ' ')}"`).join('\n');

  it('lists every string from the DESIGN.md 9.5 block', () => {
    const design = readFileSync(join(WEB_ROOT, '../../DESIGN.md'), 'utf8');
    const block = design.split('### 9.5 Copy rules')[1]?.split('### 9.6')[0] ?? '';
    const fenced = block.split('```text')[1]?.split('```')[0] ?? '';
    const designLines = fenced
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    expect(designLines.length).toBeGreaterThan(0);
    expect([...PINNED_CONSENT_COPY].sort()).toEqual([...designLines].sort());
  });

  it.each(PINNED_CONSENT_COPY.map((s) => [s]))('still ships: %s', (pinned) => {
    const found = shipsAsWholeCopy(localeText, pinned) || shipsAsWholeCopy(corpus.source, pinned);
    expect(found, `pinned copy missing from locales and src: ${pinned}`).toBe(true);
  });
});
