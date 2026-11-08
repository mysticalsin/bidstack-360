import { AgreementStageError, prisma, stageAgreementIngest } from '@bidstack/db';
import { AgreementIngestRequest } from '@bidstack/shared';

import type { Tool } from './index.js';

// Stages the document only. The API's ingest sweep extracts it into an MSA
// intake draft; a person confirms before any agreement is created or changed.
export const agreementsIngest: Tool<typeof AgreementIngestRequest> = {
  description:
    'Send a signed agreement (PDF or DOCX) into the MSA review queue. Give externalSource + externalId to dedupe; file is base64 (max 7 MB) or a public https URL. Returns the ingest item; a person reviews the draft before anything is saved.',
  input: AgreementIngestRequest,
  inputJsonSchema: {
    type: 'object',
    required: ['externalSource', 'externalId', 'fileName', 'file'],
    properties: {
      externalSource: { type: 'string', minLength: 1, maxLength: 60, pattern: '^[a-z0-9][a-z0-9_.:-]*$' },
      externalId: { type: 'string', minLength: 1, maxLength: 300 },
      fileName: { type: 'string', minLength: 1, maxLength: 255 },
      contentType: {
        type: 'string',
        enum: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      },
      file: {
        oneOf: [
          { type: 'object', required: ['base64'], properties: { base64: { type: 'string' } }, additionalProperties: false },
          { type: 'object', required: ['url'], properties: { url: { type: 'string', format: 'uri' } }, additionalProperties: false },
        ],
      },
      metadata: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          counterparty: { type: 'string' },
          companyId: { type: 'string', format: 'uuid' },
          companyName: { type: 'string' },
          signingEntity: { type: 'string' },
          signedAt: { type: 'string', format: 'date-time' },
          effectiveDate: { type: 'string', format: 'date' },
          expiryDate: { type: 'string', format: 'date' },
          countries: { type: 'array', items: { type: 'string', pattern: '^[A-Z]{2}$' } },
          sourceUrl: { type: 'string', format: 'uri' },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const key = await prisma.apiKey.findFirst({
      where: { id: ctx.keyId, orgId: ctx.orgId, revokedAt: null, deletedAt: null },
      select: { unrestrictedScope: true, companyIds: true },
    });
    if (!key) throw new Error('API key not found');
    try {
      const { item } = await stageAgreementIngest({
        orgId: ctx.orgId,
        channel: 'mcp',
        actor: { kind: 'api_key', keyId: ctx.keyId },
        companyScope: key.unrestrictedScope ? null : key.companyIds,
        request: args,
      });
      return item;
    } catch (err) {
      if (err instanceof AgreementStageError) throw new Error(err.message, { cause: err });
      throw err;
    }
  },
};
