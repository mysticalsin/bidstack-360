import { describe, expect, it } from 'vitest';

import { buildWebhookCurl } from './webhook-curl';

describe('buildWebhookCurl', () => {
  it('reproduces the stored request with the HMAC masked', () => {
    const curl = buildWebhookCurl({
      url: 'https://partner.example.com/hook',
      headers: {
        'Content-Type': 'application/json',
        'X-Polo-Signature': 't=1700000000,v1=0f9e8d7c6b5a',
      },
      body: '{"id":"m1","event":"lead.created"}',
    });
    expect(curl).toContain("curl -X POST 'https://partner.example.com/hook'");
    expect(curl).toContain("-H 'Content-Type: application/json'");
    expect(curl).toContain("-H 'X-Polo-Signature: t=1700000000,v1=****'");
    expect(curl).toContain(`--data-raw '{"id":"m1","event":"lead.created"}'`);
    expect(curl).not.toContain('0f9e8d7c6b5a');
  });

  it('never copies a signing secret even if one reaches the body', () => {
    const curl = buildWebhookCurl({
      url: 'https://partner.example.com/hook',
      headers: {},
      body: '{"secret":"placeholder-value"}',
    });
    expect(curl).not.toContain('placeholder-value');
  });

  it('escapes single quotes so the command stays one shell argument', () => {
    const curl = buildWebhookCurl({ url: 'https://x.example.com/h', headers: {}, body: `{"name":"O'Brien"}` });
    expect(curl).toContain(`'{"name":"O'\\''Brien"}'`);
  });
});
