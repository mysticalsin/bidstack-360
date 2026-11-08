import { createVerify, generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { DOCUSIGN_ENVELOPES, fakeFetch, json } from '../../test-support/agreement-source-fixtures.js';
import {
  buildJwtAssertion,
  docuSignCredentialsFromEnv,
  downloadCombinedPdf,
  getDocuSignToken,
  listCompletedEnvelopes,
  restRoot,
  type DocuSignCredentials,
} from './docusign-envelopes.js';

// Throwaway key generated per run; nothing is committed.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const CREDS: DocuSignCredentials = {
  integrationKey: 'ik-fixture',
  userId: 'user-fixture',
  privateKeyPem: PEM,
  accountId: 'acct-fixture',
  baseUrl: 'https://demo.docusign.net/restapi',
  oauthHost: 'account-d.docusign.com',
};

describe('DocuSign envelopes connector (contract)', () => {
  it('reads credentials by env name; the key is base64 PEM', () => {
    expect(docuSignCredentialsFromEnv({})).toBeNull();
    const creds = docuSignCredentialsFromEnv({
      DOCUSIGN_INTEGRATION_KEY: 'ik',
      DOCUSIGN_USER_ID: 'u',
      DOCUSIGN_PRIVATE_KEY: Buffer.from(PEM).toString('base64'),
      DOCUSIGN_ACCOUNT_ID: 'a',
      DOCUSIGN_BASE_URL: 'https://demo.docusign.net',
    });
    expect(creds?.privateKeyPem).toBe(PEM);
    expect(creds?.oauthHost).toBe('account-d.docusign.com');
  });

  it('normalizes the REST root with or without /restapi', () => {
    expect(restRoot(CREDS)).toBe('https://demo.docusign.net/restapi/v2.1/accounts/acct-fixture');
    expect(restRoot({ baseUrl: 'https://demo.docusign.net/', accountId: 'a' })).toBe(
      'https://demo.docusign.net/restapi/v2.1/accounts/a',
    );
  });

  it('signs a JWT grant assertion with the configured key', () => {
    const jwt = buildJwtAssertion(CREDS, 1_800_000_000);
    const [h, c, s] = jwt.split('.');
    const claims = JSON.parse(Buffer.from(c!, 'base64url').toString()) as Record<string, unknown>;
    expect(claims).toMatchObject({ iss: 'ik-fixture', sub: 'user-fixture', aud: 'account-d.docusign.com', scope: 'signature impersonation' });
    const verify = createVerify('RSA-SHA256');
    verify.update(`${h}.${c}`);
    expect(verify.verify(publicKey, Buffer.from(s!, 'base64url'))).toBe(true);
  });

  it('exchanges the assertion for a token', async () => {
    const { fetch, calls } = fakeFetch([['https://account-d.docusign.com/oauth/token', () => json({ access_token: 'ds-tok' })]]);
    expect(await getDocuSignToken(fetch, CREDS)).toBe('ds-tok');
    expect(new URLSearchParams(calls[0]?.body ?? '').get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
  });

  it('lists completed envelopes with the keyword filter and maps counterparty and signed date', async () => {
    const { fetch, calls } = fakeFetch([[/\/envelopes\?/, () => json(DOCUSIGN_ENVELOPES)]]);
    const list = await listCompletedEnvelopes(fetch, 'ds-tok', CREDS, { fromDate: '2026-09-01T00:00:00.000Z', keyword: 'MSA' });
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get('status')).toBe('completed');
    expect(url.searchParams.get('search_text')).toBe('MSA');
    expect(url.searchParams.get('from_date')).toBe('2026-09-01T00:00:00.000Z');
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({
      envelopeId: 'env-pfizer-001',
      subject: 'Pfizer Global MSA signature',
      completedAt: '2026-09-30T15:00:00Z',
      counterparty: 'Pfizer Inc.',
    });
    expect(list[1]?.counterparty).toBeNull();
  });

  it('keeps only envelopes built from the chosen template', async () => {
    const { fetch } = fakeFetch([
      [/env-pfizer-001\/templates/, () => json({ templates: [{ templateId: 'tpl-msa' }] })],
      [/env-other-002\/templates/, () => json({ templates: [{ templateId: 'tpl-nda' }] })],
      [/\/envelopes\?/, () => json(DOCUSIGN_ENVELOPES)],
    ]);
    const list = await listCompletedEnvelopes(fetch, 'ds-tok', CREDS, { fromDate: '2026-09-01T00:00:00.000Z', templateId: 'tpl-msa' });
    expect(list.map((e) => e.envelopeId)).toEqual(['env-pfizer-001']);
  });

  it('downloads the combined PDF read-only', async () => {
    const { fetch, calls } = fakeFetch([[/\/documents\/combined$/, () => new Response(Buffer.from('%PDF-1.7 combined'))]]);
    const buf = await downloadCombinedPdf(fetch, 'ds-tok', CREDS, 'env-pfizer-001', 1024);
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });
});
