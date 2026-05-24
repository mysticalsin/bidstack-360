/**
 * SignatureGuide — developer-facing HMAC-SHA256 verification code snippets.
 *
 * Shows Node.js / Python / Ruby examples for verifying the
 * X-BidStack-Signature header. Includes a copy-to-clipboard button
 * (silent fail when Clipboard API is unavailable) and a replay-attack
 * warning encouraging a 5-minute window check.
 */

import { useState } from 'react';

import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';

const SIGNATURE_SNIPPETS = {
  'Node.js': `const crypto = require('crypto');

function verifySignature(rawBody, header, secret) {
  const [tPart, v1Part] = header.split(',');
  const t = tPart.replace('t=', '');
  const v1 = v1Part.replace('v1=', '');

  // Reject stale events (> 5 min)
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(\`\${t}.\${rawBody}\`)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(v1, 'hex'),
    Buffer.from(expected, 'hex'),
  );
}`,
  Python: `import hmac, hashlib, time

def verify_signature(raw_body: bytes, header: str, secret: str) -> bool:
    parts = dict(item.split("=", 1) for item in header.split(","))
    t, v1 = parts.get("t", ""), parts.get("v1", "")

    # Reject stale events (> 5 min)
    if abs(time.time() - int(t)) > 300:
        return False

    expected = hmac.new(
        secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256
    ).hexdigest()

    return hmac.compare_digest(v1, expected)`,
  Ruby: `require 'openssl'

def verify_signature(raw_body, header, secret)
  parts = Hash[header.split(',').map { |p| p.split('=', 2) }]
  t, v1 = parts['t'], parts['v1']

  # Reject stale events (> 5 min)
  return false if (Time.now.to_i - t.to_i).abs > 300

  expected = OpenSSL::HMAC.hexdigest('sha256', secret, "#{t}.#{raw_body}")
  ActiveSupport::SecurityUtils.secure_compare(v1, expected)
end`,
};

type Lang = keyof typeof SIGNATURE_SNIPPETS;

export function SignatureGuide() {
  const [lang, setLang] = useState<Lang>('Node.js');
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(SIGNATURE_SNIPPETS[lang]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — silent fail
    }
  };

  return (
    <Card>
      <div className="border-b border-[var(--border-subtle)] px-5 py-4">
        <div className="flex items-center gap-2">
          <Icon name="shield" size={16} className="text-[var(--brand-primary)]" />
          <h2 className="text-sm font-semibold text-[var(--fg-primary)]">
            Signature verification
          </h2>
        </div>
        <p className="mt-1 text-xs text-[var(--fg-secondary)]">
          Every delivery includes an{' '}
          <code className="rounded bg-[var(--surface-sunken)] px-1 py-0.5 font-mono text-[11px]">
            X-BidStack-Signature
          </code>{' '}
          header. Verify it to confirm the request originated from BidStack.
          Format:{' '}
          <code className="rounded bg-[var(--surface-sunken)] px-1 py-0.5 font-mono text-[11px]">
            t=&lt;unix-seconds&gt;,v1=&lt;hmac-sha256-hex&gt;
          </code>
        </p>
      </div>

      <div className="px-5 py-4">
        {/* Lang tabs */}
        <div
          className="mb-3 flex gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-1 w-fit"
          role="tablist"
          aria-label="Signature verification language"
        >
          {(Object.keys(SIGNATURE_SNIPPETS) as Lang[]).map((l) => (
            <button
              key={l}
              type="button"
              role="tab"
              aria-selected={lang === l}
              onClick={() => setLang(l)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]',
                lang === l
                  ? 'bg-[var(--surface-card)] text-[var(--fg-primary)] shadow-sm'
                  : 'text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]',
              )}
            >
              {l}
            </button>
          ))}
        </div>

        {/* Code block */}
        <div className="relative">
          <pre className="overflow-x-auto rounded-lg bg-[var(--surface-sunken)] p-4 text-xs leading-relaxed text-[var(--fg-primary)]">
            <code>{SIGNATURE_SNIPPETS[lang]}</code>
          </pre>
          <button
            type="button"
            onClick={handleCopy}
            aria-label="Copy code"
            className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] text-[var(--fg-tertiary)] transition-colors hover:text-[var(--fg-primary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
          >
            <Icon name={copied ? 'check' : 'copy'} size={13} />
          </button>
        </div>

        <p className="mt-3 text-xs text-[var(--fg-tertiary)]">
          Reject events where{' '}
          <code className="font-mono">|now - t| &gt; 300</code>{' '}
          seconds to prevent replay attacks. Always use a timing-safe comparison.
        </p>
      </div>
    </Card>
  );
}
