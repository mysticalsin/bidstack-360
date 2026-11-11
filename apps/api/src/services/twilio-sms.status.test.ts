// WHY: Twilio retries status callbacks out of order. An older "sent" must not
// overwrite a message that has already been delivered, and a failure must not
// replace a delivery either. The status only moves forward.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const rows = new Map<
  string,
  {
    id: string;
    twilioSid: string;
    orgId: string;
    status: string;
    errorCode?: number;
    costMicros?: bigint;
    segments?: number;
  }
>();

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock('@bidstack/db', () => ({
  Prisma: { PrismaClientKnownRequestError: class extends Error {} },
  prisma: {
    smsMessage: {
      updateMany: mocks.updateMany,
      findFirst: mocks.findFirst,
    },
  },
}));

vi.mock('@bidstack/shared/token-crypto', () => ({ decryptToken: vi.fn() }));
vi.mock('../lib/serum-connector-policy.js', () => ({
  assertSerumConnectorAllowed: vi.fn(),
  recordSerumConnectorTestSuccess: vi.fn(),
}));
vi.mock('../lib/outbound-communication-guard.js', () => ({
  estimateSmsSegments: () => 1,
  outboundCommunicationCapConfig: () => ({ smsEstimatedSegmentCostMicros: 8_000n }),
  reserveOutboundCommunication: vi.fn(),
}));

import { handleStatusCallback } from './twilio-sms.service.js';

const log = { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };

function seed(status: string, orgId = 'org-1') {
  rows.clear();
  rows.set('SM1', { id: 'msg-1', twilioSid: 'SM1', orgId, status });
}

beforeEach(() => {
  rows.clear();
  mocks.updateMany.mockImplementation(async ({ where, data }) => {
    const row = rows.get(where.twilioSid);
    if (!row) return { count: 0 };
    if (where.orgId && row.orgId !== where.orgId) return { count: 0 };
    const allowed: string[] | undefined = where.status?.in ?? (typeof where.status === 'string' ? [where.status] : undefined);
    if (allowed && !allowed.includes(row.status)) return { count: 0 };
    if (typeof data.status === 'string') row.status = data.status;
    if (data.errorCode !== undefined) row.errorCode = data.errorCode;
    if (data.costMicros !== undefined) row.costMicros = data.costMicros;
    if (data.segments !== undefined) row.segments = data.segments;
    return { count: 1 };
  });
  mocks.findFirst.mockImplementation(async ({ where }) => {
    const row = rows.get(where.twilioSid);
    if (!row) return null;
    if (where.orgId && row.orgId !== where.orgId) return null;
    return row;
  });
});

async function callback(status: string, orgId = 'org-1') {
  await handleStatusCallback({ MessageSid: 'SM1', MessageStatus: status }, orgId, log);
}

describe('Twilio status only moves forward', () => {
  it('does not apply a status callback to another org', async () => {
    seed('QUEUED', 'org-b');
    await callback('sent', 'org-a');
    expect(rows.get('SM1')?.status).toBe('QUEUED');
  });

  it('does not let an older sent callback overwrite DELIVERED', async () => {
    seed('DELIVERED');
    await callback('sent');
    expect(rows.get('SM1')?.status).toBe('DELIVERED');
  });

  it('does not let failed overwrite DELIVERED', async () => {
    seed('DELIVERED');
    await callback('failed');
    expect(rows.get('SM1')?.status).toBe('DELIVERED');
  });

  it('keeps error, price, and segments when a failed callback cannot move DELIVERED', async () => {
    // WHY: a late failure callback is dropped as a status, but the carrier's
    // error and price are the only record of that attempt. An unknown status
    // is not a callback we understand, so its price is not stored.
    seed('DELIVERED');
    await handleStatusCallback(
      {
        MessageSid: 'SM1',
        MessageStatus: 'failed',
        ErrorCode: '30008',
        Price: '0.01',
        NumSegments: '2',
      },
      'org-1',
      log,
    );
    const row = rows.get('SM1');
    expect(row?.status).toBe('DELIVERED');
    expect(row?.errorCode).toBe(30008);
    expect(row?.costMicros).toBe(10_000n);
    expect(row?.segments).toBe(2);

    seed('DELIVERED');
    await handleStatusCallback(
      { MessageSid: 'SM1', MessageStatus: 'mystery', ErrorCode: '1', Price: '0.01', NumSegments: '2' },
      'org-1',
      log,
    );
    expect(rows.get('SM1')?.errorCode).toBeUndefined();
    expect(rows.get('SM1')?.costMicros).toBeUndefined();
  });

  it('moves queued to sent, then to delivered', async () => {
    seed('QUEUED');
    await callback('sent');
    expect(rows.get('SM1')?.status).toBe('SENT');
    await callback('delivered');
    expect(rows.get('SM1')?.status).toBe('DELIVERED');
  });

  it('moves sent to failed and does not move back to queued', async () => {
    seed('SENT');
    await callback('failed');
    expect(rows.get('SM1')?.status).toBe('FAILED');
    await callback('queued');
    expect(rows.get('SM1')?.status).toBe('FAILED');
  });
});
