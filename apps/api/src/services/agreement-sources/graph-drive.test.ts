import { describe, expect, it } from 'vitest';

import {
  DRIVE_ID,
  fakeFetch,
  GRAPH_DELTA_PAGE_1,
  GRAPH_DELTA_PAGE_2,
  json,
} from '../../test-support/agreement-source-fixtures.js';
import {
  deltaStartUrl,
  downloadDriveItem,
  getGraphAppToken,
  graphCredentialsFromEnv,
  GraphDriveError,
  inFolder,
  listDriveDelta,
} from './graph-drive.js';

describe('Graph drive connector (contract)', () => {
  it('reads app credentials by name and refuses the common tenant', () => {
    expect(graphCredentialsFromEnv({})).toBeNull();
    expect(
      graphCredentialsFromEnv({ MICROSOFT_TENANT_ID: 'common', MICROSOFT_GRAPH_CLIENT_ID: 'id', MICROSOFT_GRAPH_CLIENT_SECRET: 's' }),
    ).toBeNull();
    expect(
      graphCredentialsFromEnv({ MICROSOFT_TENANT_ID: 'tenant-1', MICROSOFT_GRAPH_CLIENT_ID: 'id', MICROSOFT_GRAPH_CLIENT_SECRET: 's' }),
    ).toEqual({ tenantId: 'tenant-1', clientId: 'id', clientSecret: 's' });
  });

  it('requests an app-only token with the .default scope', async () => {
    const { fetch, calls } = fakeFetch([['https://login.microsoftonline.com/', () => json({ access_token: 'tok-1' })]]);
    const token = await getGraphAppToken(fetch, { tenantId: 'tenant-1', clientId: 'id', clientSecret: 's' });
    expect(token).toBe('tok-1');
    expect(calls[0]?.url).toBe('https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token');
    expect(calls[0]?.method).toBe('POST');
    const body = new URLSearchParams(calls[0]?.body ?? '');
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('scope')).toBe('https://graph.microsoft.com/.default');
  });

  it('walks the delta feed, keeps PDF/DOCX under the folder, and returns the next cursor', async () => {
    const { fetch, calls } = fakeFetch([
      [/token=page2/, () => json(GRAPH_DELTA_PAGE_2)],
      [deltaStartUrl(DRIVE_ID), () => json(GRAPH_DELTA_PAGE_1)],
    ]);
    const page = await listDriveDelta(fetch, 'tok-1', { driveId: DRIVE_ID, folderPath: 'MSA' });
    expect(page.files.map((f) => f.id)).toEqual(['item-msa-pfizer', 'item-sow']);
    expect(page.files[0]).toMatchObject({ name: 'Pfizer Global MSA 2025.pdf', version: '"c:{A1},3"', parentPath: '/drive/root:/MSA' });
    expect(page.removedIds).toEqual(['item-gone']);
    expect(page.deltaLink).toContain('token=next-cursor');
    expect(calls.every((c) => c.headers.authorization === 'Bearer tok-1')).toBe(true);
  });

  it('resumes from a stored deltaLink', async () => {
    const { fetch, calls } = fakeFetch([[/token=page2/, () => json(GRAPH_DELTA_PAGE_2)]]);
    const page = await listDriveDelta(fetch, 'tok-1', {
      driveId: DRIVE_ID,
      deltaLink: GRAPH_DELTA_PAGE_1['@odata.nextLink'],
    });
    expect(calls).toHaveLength(1);
    expect(page.files.map((f) => f.id)).toEqual(['item-sow', 'item-elsewhere']);
  });

  it('restarts from the top when Graph expires the cursor (410)', async () => {
    let first = true;
    const { fetch } = fakeFetch([
      [
        /token=stale/,
        () => {
          first = false;
          return new Response('', { status: 410 });
        },
      ],
      [/token=page2/, () => json(GRAPH_DELTA_PAGE_2)],
      [deltaStartUrl(DRIVE_ID), () => json(GRAPH_DELTA_PAGE_1)],
    ]);
    const page = await listDriveDelta(fetch, 'tok-1', {
      driveId: DRIVE_ID,
      deltaLink: `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/root/delta?token=stale`,
    });
    expect(first).toBe(false);
    expect(page.deltaLink).toContain('next-cursor');
  });

  it('refuses a cursor that points away from Graph', async () => {
    const { fetch, calls } = fakeFetch([]);
    await expect(
      listDriveDelta(fetch, 'tok-1', { driveId: DRIVE_ID, deltaLink: 'http://169.254.169.254/latest/meta-data' }),
    ).rejects.toBeInstanceOf(GraphDriveError);
    expect(calls).toHaveLength(0);
  });

  it('downloads content with the size cap', async () => {
    const { fetch } = fakeFetch([[/\/content$/, () => new Response(Buffer.from('%PDF-1.7 tiny'), { status: 200 })]]);
    const buf = await downloadDriveItem(fetch, 'tok-1', { driveId: DRIVE_ID, itemId: 'item-msa-pfizer', maxBytes: 1024 });
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    await expect(downloadDriveItem(fetch, 'tok-1', { driveId: DRIVE_ID, itemId: 'x', maxBytes: 4 })).rejects.toThrow(/larger/);
  });

  it('matches folders by path segment, not prefix', () => {
    expect(inFolder('/drive/root:/MSA', 'MSA')).toBe(true);
    expect(inFolder('/drive/root:/MSA/Northwind', '/MSA/')).toBe(true);
    expect(inFolder('/drive/root:/MSA%20Archive', 'MSA')).toBe(false);
    expect(inFolder(null, 'MSA')).toBe(false);
    expect(inFolder(null, undefined)).toBe(true);
  });
});
