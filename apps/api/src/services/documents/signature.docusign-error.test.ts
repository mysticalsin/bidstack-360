// WHY: a DocuSign 401 on the send path used to be a credential error with a
// status. It is now a plain Error whose message is the status only. The
// document fetch must cancel the body, and the HTTP layer must still say
// Something went wrong.

import { generateKeyPairSync } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@bidstack/db', () => ({
  prisma: {
    document: {
      findFirst: vi.fn(async () => ({
        id: 'doc-1',
        orgId: 'org-1',
        name: 'proposal.pdf',
        storageUrl: 'https://files.example/proposal.pdf',
      })),
    },
    signatureRequest: {
      create: vi.fn(async () => ({ id: 'req-1' })),
      update: vi.fn(),
    },
  },
}));

const SENTINEL = 'provider-body-SENTINEL-upstream-text';

describe('DocuSign send failure', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('cancels a 401 document body and the handler hides the status error', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    process.env.DOCUSIGN_INTEGRATION_KEY = 'integration-key';
    process.env.DOCUSIGN_USER_ID = 'user-id';
    process.env.DOCUSIGN_ACCOUNT_ID = 'account-id';
    process.env.DOCUSIGN_PRIVATE_KEY = Buffer.from(pem).toString('base64');
    process.env.DOCUSIGN_BASE_URL = 'https://demo.docusign.net/restapi';

    const cancel = vi.fn(async () => undefined);
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) {
          return Response.json({ access_token: 'docusign-access', expires_in: 3600 });
        }
        return {
          ok: false,
          status: 401,
          body: { cancel },
          text: async () => SENTINEL,
        };
      }),
    );

    const { createSignatureRequest } = await import('./signature.service.js');
    const input = {
      orgId: 'org-1',
      documentId: 'doc-1',
      recipients: [{ email: 'buyer@example.com', name: 'Buyer' }],
      provider: 'DOCUSIGN' as const,
    };
    await expect(createSignatureRequest(input)).rejects.toThrow(
      /Failed to fetch document for signing: 401/,
    );
    expect(cancel).toHaveBeenCalled();
    await expect(createSignatureRequest(input)).rejects.not.toThrow(
      /provider-body-SENTINEL-upstream-text/,
    );
  });
});
