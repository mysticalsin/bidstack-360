import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import { SIGNATURE_SNIPPETS } from './signature-snippets';

const nodeRequire = createRequire(import.meta.url);

type Verify = (rawBody: string, header: string, secret: string) => boolean;

function loadNodeVerifier(): Verify {
  const factory = new Function('require', `${SIGNATURE_SNIPPETS['Node.js']}\nreturn verifySignature;`) as (
    req: NodeRequire,
  ) => Verify;
  return factory(nodeRequire);
}

function sign(secret: string, t: number, body: string): string {
  return createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
}

describe('SignatureGuide snippets', () => {
  const body = '{"id":"m1"}';
  const t = Math.floor(Date.now() / 1000);

  it('Node.js accepts any v1 during a secret rotation overlap', () => {
    const verify = loadNodeVerifier();
    const header = `t=${t},v1=${sign('new-secret', t, body)},v1=${sign('old-secret', t, body)}`;
    expect(verify(body, header, 'old-secret')).toBe(true);
    expect(verify(body, header, 'new-secret')).toBe(true);
    expect(verify(body, header, 'other-secret')).toBe(false);
  });

  it('Node.js rejects a malformed v1 without throwing', () => {
    const verify = loadNodeVerifier();
    expect(verify(body, `t=${t},v1=abc`, 'old-secret')).toBe(false);
  });

  it('Python and Ruby compare against every v1 value', () => {
    expect(SIGNATURE_SNIPPETS.Python).toMatch(/any\(hmac\.compare_digest\(expected, v1\) for v1 in sigs\)/);
    expect(SIGNATURE_SNIPPETS.Ruby).toMatch(/sigs\.any\?/);
  });
});
