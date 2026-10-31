import type * as ApiModule from '@/lib/api';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: vi.fn(), getAuthToken: vi.fn(async () => 'tok') };
});

import { ApiError, api } from '@/lib/api';

import { isMissingRoute, isOwnApiUrl, listQueryString, msaClient, uploadMsaVersion, validateMsaFile } from './client';
import { actionLabel, urgency } from './labels';
import { filterRows, sampleDetail, sampleRows, sampleSummary, sampleTimeline } from './sample';

const NOW = Date.UTC(2026, 9, 31);
const missing = new ApiError('Route GET:/api/v1/msa not found', 404, { message: 'Route GET:/api/v1/msa not found', error: 'Not Found', statusCode: 404 });

afterEach(() => vi.mocked(api).mockReset());

describe('isMissingRoute', () => {
  it('is true only for the Fastify unknown-route 404', () => {
    expect(isMissingRoute(missing)).toBe(true);
    expect(isMissingRoute(new ApiError('Agreement not found', 404, { message: 'Agreement not found' }))).toBe(false);
    expect(isMissingRoute(new ApiError('Forbidden', 403, { message: 'Route GET:/x not found' }))).toBe(false);
    expect(isMissingRoute(new Error('Route GET:/x not found'))).toBe(false);
  });
});

describe('msaClient sample fallback', () => {
  it('falls back to labelled Sample data when the API has no MSA routes', async () => {
    vi.mocked(api).mockRejectedValueOnce(missing);
    const res = await msaClient.list({ topLevel: 'false' });
    expect(res.sample).toBe(true);
    expect(res.data.items.length).toBeGreaterThan(5);
  });
  it('returns live data untouched', async () => {
    vi.mocked(api).mockResolvedValueOnce({ items: [], nextCursor: null, total: 0 });
    await expect(msaClient.list({})).resolves.toEqual({ data: { items: [], nextCursor: null, total: 0 }, sample: false });
  });
  it('surfaces real errors (403, record 404) instead of sampling', async () => {
    vi.mocked(api).mockRejectedValueOnce(new ApiError('Forbidden', 403, { message: 'Forbidden' }));
    await expect(msaClient.list({})).rejects.toMatchObject({ status: 403 });
    vi.mocked(api).mockRejectedValueOnce(new ApiError('Agreement not found', 404, { message: 'Agreement not found' }));
    await expect(msaClient.detail('a0000000-0000-4000-8000-000000000101')).rejects.toMatchObject({ status: 404 });
  });
  it('builds repeated params for arrays and skips empties', () => {
    expect(listQueryString({ status: ['active', 'pending'], q: '', companyId: 'c1' })).toBe('?status=active&status=pending&companyId=c1');
    expect(listQueryString({})).toBe('');
  });
});

describe('validateMsaFile', () => {
  it('accepts PDF/DOCX by type or extension, rejects others, empties and > 25 MB', () => {
    expect(validateMsaFile({ name: 'a.pdf', size: 10, type: 'application/pdf' })).toEqual({ contentType: 'application/pdf' });
    expect(validateMsaFile({ name: 'a.DOCX', size: 10, type: '' })).toEqual({ contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    expect(validateMsaFile({ name: 'a.png', size: 10, type: 'image/png' })).toEqual({ error: expect.stringMatching(/PDF and Word/) });
    expect(validateMsaFile({ name: 'a.pdf', size: 0, type: 'application/pdf' })).toEqual({ error: expect.stringMatching(/empty/) });
    expect(validateMsaFile({ name: 'a.pdf', size: 25 * 1024 * 1024 + 1, type: 'application/pdf' })).toEqual({ error: expect.stringMatching(/25 MB/) });
  });
});

describe('uploadMsaVersion', () => {
  it('runs upload-url → PUT → finalize and reports each stage', async () => {
    const file = new File(['%PDF-1.7 hello'], 'msa.pdf', { type: 'application/pdf' });
    vi.mocked(api)
      .mockResolvedValueOnce({ uploadUrl: 'https://bucket.s3.example/k?X-Amz-Signature=x', storageKey: 'org/msa/k', headers: { 'Content-Type': 'application/pdf' }, maxBytes: 1 })
      .mockResolvedValueOnce({ id: 'v1', versionNo: 2, sha256: 'abc' });
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const stages: string[] = [];
    const out = await uploadMsaVersion('m1', file, 'Signed', (s) => stages.push(s));
    expect(out.versionNo).toBe(2);
    expect(stages).toEqual(['validating', 'requesting', 'uploading', 'finalizing', 'done']);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/^https:\/\/bucket/);
    // Presigned URL: no bearer token, no cookies.
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(init.credentials).toBeUndefined();
    expect(vi.mocked(api).mock.calls[1]![1]).toMatchObject({ method: 'POST', body: { storageKey: 'org/msa/k', note: 'Signed', fileName: 'msa.pdf', bytes: file.size } });
    vi.unstubAllGlobals();
  });
  it('sends the session to the local-driver upload endpoint', async () => {
    const file = new File(['x'], 'msa.docx', { type: '' });
    vi.mocked(api)
      .mockResolvedValueOnce({ uploadUrl: 'https://api.example.com/api/files/local-upload?key=k', storageKey: 'k', headers: {}, maxBytes: 1 })
      .mockResolvedValueOnce({ id: 'v1', versionNo: 1, sha256: 'abc' });
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await uploadMsaVersion('m1', file, null);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(init.credentials).toBe('include');
    vi.unstubAllGlobals();
  });
  it('stops before the network on an invalid file, and reports a failed PUT', async () => {
    await expect(uploadMsaVersion('m1', new File(['x'], 'a.exe'), null)).rejects.toThrow(/PDF and Word/);
    expect(api).not.toHaveBeenCalled();
    vi.mocked(api).mockResolvedValueOnce({ uploadUrl: '/api/files/local-upload?key=k', storageKey: 'k', headers: {}, maxBytes: 1 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 413 })));
    await expect(uploadMsaVersion('m1', new File(['x'], 'a.pdf', { type: 'application/pdf' }), null)).rejects.toThrow(/413/);
    expect(api).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
  it('treats relative and same-API URLs as own', () => {
    expect(isOwnApiUrl('/api/files/local-upload?key=k')).toBe(true);
    expect(isOwnApiUrl('https://s3.eu-west-1.amazonaws.com/b/k?sig')).toBe(false);
  });
});

describe('sample data + filterRows (mirrors the API list semantics)', () => {
  const rows = sampleRows(NOW);
  it('hides children by default and shows them with topLevel=false', () => {
    expect(filterRows(rows, {}).every((r) => r.parentId === null)).toBe(true);
    expect(filterRows(rows, { topLevel: 'false' }).some((r) => r.kind === 'sow')).toBe(true);
  });
  it('filters by status, kind, account, expiry window and text', () => {
    expect(filterRows(rows, { status: ['pending'] }).map((r) => r.reference)).toEqual(['MAH-MSA-2025']);
    expect(filterRows(rows, { kind: ['sow'], topLevel: 'false' }).every((r) => r.kind === 'sow')).toBe(true);
    expect(filterRows(rows, { expiringWithinDays: 60, topLevel: 'false' }).map((r) => r.daysToExpiry)).toEqual([21, 38]);
    expect(filterRows(rows, { q: 'dnb' }).map((r) => r.reference)).toEqual(['DNB-FW-2024']);
    expect(filterRows(rows, { companyId: 'c0000000-0000-4000-8000-000000000003' })).toHaveLength(1);
  });
  it('sorts by soonest expiry, undated last', () => {
    const d = filterRows(rows, {}).map((r) => r.daysToExpiry);
    expect(d.slice(0, 3)).toEqual([-200, 38, 74]);
    expect(d.at(-1)).toBeNull();
  });
  it('computes notice deadlines and remaps the CI set onto another account', () => {
    const msa = rows.find((r) => r.reference === 'CIF-MSA-2023')!;
    expect(msa.noticeDeadline).toBe(new Date(NOW + (74 - 90) * 86_400_000).toISOString());
    const other = sampleRows(NOW, { id: 'x', name: 'Other plc' });
    expect(other.filter((r) => r.companyId === 'x')).toHaveLength(5);
  });
  it('detail, timeline and summary are consistent', () => {
    const d = sampleDetail('a0000000-0000-4000-8000-000000000101', NOW)!;
    expect(d.children.map((c) => c.reference)).toEqual(['CIF-SOW-07', 'CIF-SOW-08', 'CIF-AMD-02']);
    expect(d.versions.map((v) => v.versionNo)).toEqual([3, 2, 1]);
    const t = sampleTimeline(d.id, NOW).map((e) => e.action);
    expect(t).toEqual(expect.arrayContaining(['msa.create', 'msa.version.upload', 'msa.notice_deadline', 'msa.renewal']));
    const s = sampleSummary('c0000000-0000-4000-8000-000000000001', 'CI Financial', NOW);
    expect(s.total).toBe(5);
    expect(s.childCounts).toMatchObject({ sow: 2, amendment: 1 });
    expect(s.nextExpiry?.days).toBe(21);
  });
  it('labels', () => {
    expect(actionLabel('msa.version.upload', { versionNo: 3 })).toBe('New version uploaded (v3)');
    expect(actionLabel('msa.something_new')).toBe('something new');
    expect([urgency(-1), urgency(10), urgency(90), urgency(null)]).toEqual(['overdue', 'soon', 'later', 'none']);
  });
});

describe('snippetParts', () => {
  it('splits [[matches]] without producing HTML', async () => {
    const { snippetParts } = await import('./labels');
    expect(snippetParts('a [[b]] c [[<i>]]')).toEqual([
      { text: 'a ', hit: false }, { text: 'b', hit: true }, { text: ' c ', hit: false }, { text: '<i>', hit: true },
    ]);
    expect(snippetParts('plain')).toEqual([{ text: 'plain', hit: false }]);
  });
});

