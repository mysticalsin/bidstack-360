import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';

const SIGNATURE_SNIPPETS = {
  'Node.js': `const crypto = require('crypto');

function verifySignature(rawBody, header, secret) {
  const [tPart, v1Part] = header.split(',');
  const t = tPart.replace('t=', '');
  const v1 = v1Part.replace('v1=', '');

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

  return false if (Time.now.to_i - t.to_i).abs > 300

  expected = OpenSSL::HMAC.hexdigest('sha256', secret, "#{t}.#{raw_body}")
  ActiveSupport::SecurityUtils.secure_compare(v1, expected)
end`,
};

type Lang = keyof typeof SIGNATURE_SNIPPETS;

export function SignatureGuide() {
  const { t } = useTranslation('signatures');
  const [lang, setLang] = useState<Lang>('Node.js');
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(SIGNATURE_SNIPPETS[lang]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-[var(--border-subtle)] px-5 py-4">
        <div className="flex items-center gap-2">
          <Icon name="shield" size={16} className="text-[var(--brand-primary)]" />
          <h2 className="text-sm font-semibold text-[var(--fg-primary)]">{t('signatureGuide.title', 'Signature verification')}</h2>
        </div>
        <p className="mt-1 text-xs leading-5 text-[var(--fg-secondary)]">
          {t('signatureGuide.introBefore', 'Every delivery includes an')}{' '}
          <code className="rounded bg-[var(--surface-sunken)] px-1 py-0.5 font-mono text-[11px]">
            X-BidStack-Signature
          </code>{' '}
          {t('signatureGuide.introAfter', 'header. Verify it before trusting the payload. Format:')}{' '}
          <code className="rounded bg-[var(--surface-sunken)] px-1 py-0.5 font-mono text-[11px]">
            t=&lt;unix-seconds&gt;,v1=&lt;hmac-sha256-hex&gt;
          </code>
        </p>
      </div>

      <div className="px-5 py-4">
        <div
          className="mb-3 flex w-fit gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-1"
          role="tablist"
          aria-label={t('signatureGuide.languageTablistLabel', 'Signature verification language')}
        >
          {(Object.keys(SIGNATURE_SNIPPETS) as Lang[]).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={lang === item}
              onClick={() => setLang(item)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]',
                lang === item
                  ? 'bg-[var(--surface-card)] text-[var(--fg-primary)] shadow-sm'
                  : 'text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]',
              )}
            >
              {item}
            </button>
          ))}
        </div>

        <div className="relative">
          <pre className="max-h-[420px] overflow-auto rounded-xl bg-[var(--surface-sunken)] p-4 text-xs leading-relaxed text-[var(--fg-primary)]">
            <code>{SIGNATURE_SNIPPETS[lang]}</code>
          </pre>
          <button
            type="button"
            onClick={handleCopy}
            aria-label={t('signatureGuide.copyCodeLabel', 'Copy code')}
            className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] text-[var(--fg-tertiary)] transition-colors hover:text-[var(--fg-primary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
          >
            <Icon name={copied ? 'check' : 'copy'} size={14} />
          </button>
        </div>

        <p className="mt-3 text-xs text-[var(--fg-tertiary)]">
          {t('signatureGuide.replayBefore', 'Reject events where')}{' '}
          <code className="font-mono">|now - t| &gt; 300</code>{' '}
          {t(
            'signatureGuide.replayAfter',
            'seconds to prevent replay attacks. Always use a timing-safe comparison.',
          )}
        </p>
      </div>
    </Card>
  );
}
