import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import {
  MSA_MAX_INDEXED_CHARS,
  normalizeExtractedText,
  processMsaTextExtract,
  type MsaExtractDeps,
} from './msa-text-extract.js';

const stamp = Date.now();
let orgA = '';
let orgB = '';
let contractId = '';
let versionId = '';
let storageKey = '';

async function seedOrg(label: string) {
  const org = await prisma.org.create({ data: { name: `MSA extract ${label}`, clerkOrg: `org_msa_extract_${label}_${stamp}` } });
  const user = await prisma.user.create({
    data: { orgId: org.id, clerkUser: `user_msa_extract_${label}_${stamp}`, email: `msa.${label}.${stamp}@test.local`, name: 'U' },
  });
  return { orgId: org.id, userId: user.id };
}

beforeAll(async () => {
  const a = await seedOrg('a');
  const b = await seedOrg('b');
  orgA = a.orgId;
  orgB = b.orgId;
  const contract = await prisma.contractAgreement.create({
    data: { orgId: orgA, accountKey: 'acme', kind: 'msa', reference: 'MSA-1', title: 'MSA', createdById: a.userId },
  });
  contractId = contract.id;
  storageKey = `orgs/${orgA}/accounts/msa-${contractId}/x-msa.pdf`;
  const file = await prisma.fileAttachment.create({
    data: { orgId: orgA, accountId: `msa-${contractId}`, name: 'msa.pdf', contentType: 'application/pdf', bytes: 10, storageKey },
  });
  const v = await prisma.contractFileVersion.create({
    data: {
      orgId: orgA,
      contractId,
      versionNo: 1,
      fileAttachmentId: file.id,
      fileName: 'msa.pdf',
      contentType: 'application/pdf',
      bytes: 10,
      sha256: 'a'.repeat(64),
      createdById: a.userId,
    },
  });
  versionId = v.id;
});

afterAll(async () => {
  for (const id of [orgA, orgB]) {
    if (id) await prisma.org.delete({ where: { id } }).catch(() => undefined);
  }
});

function deps(text: string | Error, seen: string[] = []): MsaExtractDeps {
  return {
    read: async ({ storageKey: key }) => {
      seen.push(key);
      return { buffer: Buffer.from('%PDF-1.7') };
    },
    extract: async () => {
      if (text instanceof Error) throw text;
      return text;
    },
  };
}

describe('normalizeExtractedText', () => {
  it('drops NULs, squeezes whitespace and caps length', () => {
    expect(normalizeExtractedText('a\u0000b   c\n\n\n\nd').text).toBe('ab c\n\nd');
    const long = normalizeExtractedText('x'.repeat(MSA_MAX_INDEXED_CHARS + 10));
    expect(long.truncated).toBe(true);
    expect(long.text).toHaveLength(MSA_MAX_INDEXED_CHARS);
  });
});

describe('processMsaTextExtract', () => {
  it('stores extracted text, reading the key from the DB row', async () => {
    const seen: string[] = [];
    const out = await processMsaTextExtract({ orgId: orgA, contractId, versionId }, deps('Limitation of liability: EUR 2m', seen));
    expect(out).toBe('done');
    expect(seen).toEqual([storageKey]);
    const v = await prisma.contractFileVersion.findUniqueOrThrow({ where: { id: versionId } });
    expect(v.extractionStatus).toBe('done');
    expect(v.extractedText).toContain('Limitation of liability');
    expect(v.extractedAt).not.toBeNull();
  });

  it('skips a payload that names another org', async () => {
    const out = await processMsaTextExtract({ orgId: orgB, contractId, versionId }, deps('leak'));
    expect(out).toBe('skipped');
    const v = await prisma.contractFileVersion.findUniqueOrThrow({ where: { id: versionId } });
    expect(v.extractedText).not.toContain('leak');
  });

  it('keeps pending and rethrows while retries remain, then records the error', async () => {
    await expect(
      processMsaTextExtract({ orgId: orgA, contractId, versionId }, deps(new Error('boom')), { finalAttempt: false }),
    ).rejects.toThrow('boom');
    expect((await prisma.contractFileVersion.findUniqueOrThrow({ where: { id: versionId } })).extractionStatus).toBe('pending');
    const out = await processMsaTextExtract({ orgId: orgA, contractId, versionId }, deps(new Error('boom')), { finalAttempt: true });
    expect(out).toBe('failed');
    const v = await prisma.contractFileVersion.findUniqueOrThrow({ where: { id: versionId } });
    expect(v.extractionStatus).toBe('error');
    expect(v.extractionError).toBe('boom');
  });

  it('skips archived versions', async () => {
    await prisma.contractFileVersion.update({ where: { id: versionId }, data: { deletedAt: new Date() } });
    expect(await processMsaTextExtract({ orgId: orgA, contractId, versionId }, deps('x'))).toBe('skipped');
  });
});
