import type { Logger as PinoLogger } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const pipeline = {
    decrby: vi.fn(),
    expire: vi.fn(),
    exec: vi.fn(),
  };
  pipeline.decrby.mockReturnValue(pipeline);
  pipeline.expire.mockReturnValue(pipeline);

  return {
    ensureRedisReady: vi.fn(),
    eval: vi.fn(),
    pipeline,
  };
});

vi.mock('../redis.js', () => ({
  ensureRedisReady: mocks.ensureRedisReady,
  redis: {
    eval: mocks.eval,
    pipeline: () => mocks.pipeline,
  },
}));

import {
  OutboundCommunicationCapUnavailableError,
  OutboundCommunicationLimitError,
  estimateSmsSegments,
  reserveOutboundCommunication,
} from './outbound-communication-guard.js';

const orgId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const log = {
  warn: vi.fn(),
} as unknown as PinoLogger;

const OLD_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...OLD_ENV, NODE_ENV: 'test' };
  mocks.ensureRedisReady.mockResolvedValue(true);
  mocks.eval.mockResolvedValue([1, 'ok', 1, 1]);
  mocks.pipeline.exec.mockResolvedValue([]);
});

afterEach(() => {
  process.env = OLD_ENV;
});

describe('outbound communication caps', () => {
  it('estimates SMS segments for ASCII and unicode messages', () => {
    expect(estimateSmsSegments('hello')).toBe(1);
    expect(estimateSmsSegments('a'.repeat(161))).toBe(2);
    expect(estimateSmsSegments('é'.repeat(71))).toBe(2);
  });

  it('reserves email volume and can roll back before provider acceptance', async () => {
    const reservation = await reserveOutboundCommunication(
      { channel: 'email', orgId, userId, units: 3 },
      log,
    );

    expect(mocks.eval).toHaveBeenCalledWith(
      expect.any(String),
      3,
      expect.stringContaining(':email:daily:user:'),
      expect.stringContaining(':email:daily:org:'),
      expect.stringContaining(':email:daily:org:'),
      '3',
      '0',
      '500',
      '50000',
      '0',
      '172800',
    );

    await reservation.rollback();

    expect(mocks.pipeline.decrby).toHaveBeenCalledWith(expect.stringContaining(':user:'), 3);
    expect(mocks.pipeline.decrby).toHaveBeenCalledWith(expect.stringContaining(':org:'), 3);
  });

  it('fails with 429 when the SMS org cost cap is reached', async () => {
    mocks.eval.mockResolvedValueOnce([0, 'org-cost', '500000000', '500000000']);

    await expect(
      reserveOutboundCommunication(
        { channel: 'sms', orgId, userId, units: 1, estimatedCostMicros: 8_000n },
        log,
      ),
    ).rejects.toBeInstanceOf(OutboundCommunicationLimitError);
  });

  it('fails closed in production when Redis is unavailable', async () => {
    process.env.NODE_ENV = 'production';
    mocks.ensureRedisReady.mockResolvedValueOnce(false);

    await expect(
      reserveOutboundCommunication({ channel: 'email', orgId, userId, units: 1 }, log),
    ).rejects.toBeInstanceOf(OutboundCommunicationCapUnavailableError);
  });

  it('fails open outside production when Redis is unavailable', async () => {
    mocks.ensureRedisReady.mockResolvedValueOnce(false);

    const reservation = await reserveOutboundCommunication(
      { channel: 'email', orgId, userId, units: 1 },
      log,
    );

    expect(reservation.channel).toBe('email');
    expect(log.warn).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'outbound communication cap check unavailable; allowing request',
    );
  });
});
