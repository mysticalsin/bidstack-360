/**
 * MSA one-drop intake, signing entities, confirm, and HEMA leverage.
 * Uses a real text-layer PDF so extraction is not guessed from comments.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { prisma } from '@bidstack/db';

import { invalidateAccessScope } from '../lib/access-scope.js';
import { buildServer } from '../server.js';
import { __setStorageForTest } from '../storage/index.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';
import { makeFakeStorage, PDF_TYPE, type FakeStorage } from '../test-support/msa-storage.js';
import { syntheticNorthwindMsaPdf } from '../test-support/synthetic-msa-pdf.js';

let server: FastifyInstance;
let orgA = { orgId: '', clerkOrg: '' };
let restoreAuth: (() => void) | null = null;
let storage: FakeStorage;
let pdf: Buffer;

type Inj = { method: 'GET' | 'POST' | 'PATCH'; url: string; payload?: unknown; role?: string };
function call({ method, url, payload, role }: Inj) {
  return server.inject({
    method,
    url: `/api/v1${url}`,
    ...(payload !== undefined ? { payload: payload as object } : {}),
    headers: role ? { 'x-bidstack-e2e-role': role } : {},
  });
}

async function uploadIntake(body: Buffer, fileName = 'northwind-msa.pdf') {
  const urlRes = await call({
    method: 'POST',
    url: '/msa/intake/upload-url',
    payload: { fileName, contentType: PDF_TYPE, bytes: body.length },
  });
  expect(urlRes.statusCode, urlRes.body).toBe(200);
  const { storageKey, draftId } = urlRes.json() as { storageKey: string; draftId: string };
  storage.put(storageKey, body, PDF_TYPE);
  const res = await call({
    method: 'POST',
    url: '/msa/intake',
    payload: { fileName, contentType: PDF_TYPE, bytes: body.length, storageKey, draftId },
  });
  return { res, draftId };
}

beforeAll(async () => {
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  orgA = await createIsolatedOrg('msa-intake');
  restoreAuth = useIsolatedOrgAuth(orgA.clerkOrg);
  pdf = await syntheticNorthwindMsaPdf();
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  __setStorageForTest(null);
  await server?.close();
  restoreAuth?.();
  invalidateAccessScope(orgA.orgId);
  if (orgA.orgId) await dropIsolatedOrg(orgA.orgId);
});

beforeEach(() => {
  storage = makeFakeStorage('s3');
  __setStorageForTest(storage);
});

describe('MSA intake and leverage', () => {
  it('extracts cited fields, matches Northwind + HEMA, and confirms without inventing', async () => {
    const { res } = await uploadIntake(pdf);
    expect(res.statusCode, res.body).toBe(201);
    const draft = res.json() as {
      id: string;
      needsOcr: boolean;
      usedLlm: boolean;
      extractedFields: Record<string, { found: boolean; value: unknown; citation: { clause: string | null } | null }>;
      accountMatches: Array<{ name: string; companyId: string }>;
      signingEntityMatches: Array<{ slug: string; name: string }>;
    };
    expect(draft.needsOcr).toBe(false);
    expect(draft.usedLlm).toBe(false);
    expect(draft.extractedFields.clientParty.found).toBe(true);
    expect(String(draft.extractedFields.clientParty.value)).toMatch(/Northwind Pharma/i);
    expect(draft.extractedFields.clientParty.citation?.clause).toMatch(/Clause/i);
    expect(draft.extractedFields.governingLaw.found).toBe(true);
    expect(draft.extractedFields.liabilityCap.found).toBe(true);
    expect(draft.accountMatches[0]?.name).toMatch(/Northwind Pharma/i);
    expect(draft.signingEntityMatches.some((m) => m.slug === 'hema' || /hema/i.test(m.name))).toBe(true);

    const confirm = await call({
      method: 'POST',
      url: `/msa/intake/${draft.id}/confirm`,
      payload: {
        companyId: draft.accountMatches[0]!.companyId,
        signingEntityId: (
          await prisma.signingEntity.findFirstOrThrow({
            where: { orgId: orgA.orgId, slug: 'hema', deletedAt: null },
          })
        ).id,
        status: 'active',
      },
    });
    expect(confirm.statusCode, confirm.body).toBe(201);
    const { contractId } = confirm.json() as { contractId: string };

    const detail = await call({ method: 'GET', url: `/msa/${contractId}` });
    expect(detail.statusCode, detail.body).toBe(200);
    const row = detail.json() as { signingEntity: { slug: string } | null; scopeOfServices: string | null };
    expect(row.signingEntity?.slug).toBe('hema');
    expect(row.scopeOfServices).toMatch(/does not include information technology/i);

    const flag = await call({ method: 'GET', url: `/msa/${contractId}/leverage` });
    expect(flag.statusCode, flag.body).toBe(200);
    const body = flag.json() as { flag: { headline: string; scopeNeedsAmendment: boolean; missingLines: string[] } | null };
    expect(body.flag).toBeTruthy();
    expect(body.flag!.headline).toMatch(/HEMA/i);
    expect(body.flag!.missingLines).toEqual(expect.arrayContaining(['it']));
    expect(body.flag!.scopeNeedsAmendment).toBe(true);

    const value = await call({ method: 'GET', url: `/msa/${contractId}/value-panel` });
    expect(value.statusCode, value.body).toBe(200);
    const panel = value.json() as { items: Array<{ kind: string; absence: boolean; title: string }> };
    expect(panel.items.some((i) => i.kind === 'weak_clause')).toBe(true);
    expect(panel.items.some((i) => i.kind === 'uncovered_service')).toBe(true);
  });

  it('blocks confirm on a scanned PDF and never sends the file to an LLM', async () => {
    const scanned = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n');
    const { res } = await uploadIntake(scanned, 'scan.pdf');
    expect(res.statusCode, res.body).toBe(201);
    const draft = res.json() as { id: string; needsOcr: boolean; usedLlm: boolean };
    expect(draft.needsOcr).toBe(true);
    expect(draft.usedLlm).toBe(false);
    const confirm = await call({
      method: 'POST',
      url: `/msa/intake/${draft.id}/confirm`,
      payload: { createCompany: { name: 'Scan Client' } },
    });
    expect(confirm.statusCode).toBe(400);
    expect(confirm.json()).toMatchObject({ message: expect.stringMatching(/OCR/i) });
  });

  it('lets Presales confirm and create an account; Read-Only cannot upload', async () => {
    const forbidden = await call({
      method: 'POST',
      url: '/msa/intake/upload-url',
      payload: { fileName: 'a.pdf', contentType: PDF_TYPE, bytes: 12 },
      role: 'read-only',
    });
    expect(forbidden.statusCode).toBe(403);

    const { res } = await uploadIntake(pdf, 'presales.pdf');
    expect(res.statusCode, res.body).toBe(201);
    const draft = res.json() as { id: string };
    const confirm = await call({
      method: 'POST',
      url: `/msa/intake/${draft.id}/confirm`,
      payload: { createCompany: { name: 'New Pharma Account' }, status: 'active' },
      role: 'presales',
    });
    expect(confirm.statusCode, confirm.body).toBe(201);
    const out = confirm.json() as { createdCompany: boolean; companyId: string };
    expect(out.createdCompany).toBe(true);
  });

  it('exposes HEMA leverage summary and an admin-editable signing-entity list', async () => {
    const entities = await call({ method: 'GET', url: '/settings/signing-entities' });
    expect(entities.statusCode, entities.body).toBe(200);
    const list = entities.json() as { items: Array<{ slug: string; verificationStatus: string }> };
    expect(list.items.some((e) => e.slug === 'hema')).toBe(true);

    const created = await call({
      method: 'POST',
      url: '/settings/signing-entities',
      payload: {
        slug: 'test-branch',
        name: 'Test Branch',
        brandFamily: 'other',
        aliases: [],
        businessLines: ['consulting'],
        sourceUrl: 'https://www.amaris.com',
      },
    });
    expect(created.statusCode, created.body).toBe(201);

    const summary = await call({ method: 'GET', url: '/msa/leverage/summary' });
    expect(summary.statusCode, summary.body).toBe(200);
    const counts = summary.json() as { hemaPharmaAccounts: number };
    expect(counts.hemaPharmaAccounts).toBeGreaterThanOrEqual(1);
  });
});
