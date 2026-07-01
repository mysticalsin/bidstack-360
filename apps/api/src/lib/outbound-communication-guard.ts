import type { Logger as PinoLogger } from 'pino';

import { ensureRedisReady, redis } from '../redis.js';

type OutboundChannel = 'email' | 'sms';
type GuardLogger = Pick<PinoLogger, 'warn'>;

const UTC_DAY_TTL_SECONDS = 48 * 60 * 60;

const RESERVE_SCRIPT = `
local user_count = tonumber(redis.call('GET', KEYS[1]) or '0')
local org_count = tonumber(redis.call('GET', KEYS[2]) or '0')
local org_cost = tonumber(redis.call('GET', KEYS[3]) or '0')

local units = tonumber(ARGV[1])
local cost = tonumber(ARGV[2])
local user_limit = tonumber(ARGV[3])
local org_limit = tonumber(ARGV[4])
local cost_limit = tonumber(ARGV[5])
local ttl = tonumber(ARGV[6])

if user_limit > 0 and user_count + units > user_limit then
  return {0, 'user-volume', user_count, user_limit}
end

if org_limit > 0 and org_count + units > org_limit then
  return {0, 'org-volume', org_count, org_limit}
end

if cost_limit > 0 and org_cost + cost > cost_limit then
  return {0, 'org-cost', org_cost, cost_limit}
end

redis.call('INCRBY', KEYS[1], units)
redis.call('EXPIRE', KEYS[1], ttl)
redis.call('INCRBY', KEYS[2], units)
redis.call('EXPIRE', KEYS[2], ttl)
if cost > 0 then
  redis.call('INCRBY', KEYS[3], cost)
  redis.call('EXPIRE', KEYS[3], ttl)
end

return {1, 'ok', user_count + units, org_count + units, org_cost + cost}
`;

export class OutboundCommunicationLimitError extends Error {
  readonly statusCode = 429;

  constructor(message: string) {
    super(message);
    this.name = 'OutboundCommunicationLimitError';
  }
}

export class OutboundCommunicationCapUnavailableError extends Error {
  readonly statusCode = 503;

  constructor(message: string) {
    super(message);
    this.name = 'OutboundCommunicationCapUnavailableError';
  }
}

export interface OutboundCommunicationReservation {
  channel: OutboundChannel;
  rollback: () => Promise<void>;
}

interface CapConfig {
  emailDailyUserLimit: number;
  emailDailyOrgLimit: number;
  smsDailyUserLimit: number;
  smsDailyOrgLimit: number;
  smsDailyOrgCostCapMicros: bigint;
  smsEstimatedSegmentCostMicros: bigint;
}

function parseNonNegativeIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new OutboundCommunicationCapUnavailableError(`${name} must be a non-negative integer.`);
  }

  return parsed;
}

function parseNonNegativeBigIntEnv(name: string, fallback: bigint): bigint {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;

  try {
    const parsed = BigInt(raw);
    if (parsed < 0n) throw new Error('negative');
    return parsed;
  } catch {
    throw new OutboundCommunicationCapUnavailableError(`${name} must be a non-negative integer.`);
  }
}

export function outboundCommunicationCapConfig(): CapConfig {
  return {
    emailDailyUserLimit: parseNonNegativeIntEnv('OUTBOUND_EMAIL_DAILY_USER_LIMIT', 500),
    emailDailyOrgLimit: parseNonNegativeIntEnv('OUTBOUND_EMAIL_DAILY_ORG_LIMIT', 50_000),
    smsDailyUserLimit: parseNonNegativeIntEnv('OUTBOUND_SMS_DAILY_USER_LIMIT', 100),
    smsDailyOrgLimit: parseNonNegativeIntEnv('OUTBOUND_SMS_DAILY_ORG_LIMIT', 10_000),
    smsDailyOrgCostCapMicros: parseNonNegativeBigIntEnv(
      'OUTBOUND_SMS_DAILY_ORG_COST_CAP_MICROS',
      500_000_000n,
    ),
    smsEstimatedSegmentCostMicros: parseNonNegativeBigIntEnv(
      'OUTBOUND_SMS_ESTIMATED_SEGMENT_COST_MICROS',
      8_000n,
    ),
  };
}

function outboundCapRedisRequired(): boolean {
  const raw = process.env.OUTBOUND_COMM_REDIS_REQUIRED;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

function utcDate(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function keysFor(channel: OutboundChannel, orgId: string, userId: string, nowMs = Date.now()) {
  const day = utcDate(nowMs);
  return {
    userCountKey: `bidstack:outbound:${channel}:daily:user:${orgId}:${userId}:${day}:count`,
    orgCountKey: `bidstack:outbound:${channel}:daily:org:${orgId}:${day}:count`,
    orgCostKey: `bidstack:outbound:${channel}:daily:org:${orgId}:${day}:costMicros`,
  };
}

function limitMessage(channel: OutboundChannel, reason: string, limit: string): string {
  if (reason === 'user-volume') {
    return `Daily ${channel} user send limit of ${limit} reached.`;
  }
  if (reason === 'org-volume') {
    return `Daily ${channel} org send limit of ${limit} reached.`;
  }
  return `Daily SMS org estimated cost cap of $${Number(limit) / 1_000_000} reached.`;
}

function normalizeEvalResult(result: unknown): [number, string, string, string] {
  if (!Array.isArray(result) || result.length < 4) {
    throw new OutboundCommunicationCapUnavailableError(
      'Outbound communication cap check returned an invalid result.',
    );
  }

  return [Number(result[0]), String(result[1]), String(result[2]), String(result[3])];
}

export function estimateSmsSegments(body: string): number {
  const length = Math.max(body.length, 1);
  const usesUnicodeSegments = Array.from(body).some((char) => char.charCodeAt(0) > 127);
  const singleSegmentLimit = usesUnicodeSegments ? 70 : 160;
  const multipartSegmentLimit = usesUnicodeSegments ? 67 : 153;

  if (length <= singleSegmentLimit) return 1;
  return Math.ceil(length / multipartSegmentLimit);
}

export async function reserveOutboundCommunication(
  args: {
    channel: OutboundChannel;
    orgId: string;
    userId: string;
    units: number;
    estimatedCostMicros?: bigint;
  },
  log: GuardLogger,
): Promise<OutboundCommunicationReservation> {
  const units = Math.max(1, Math.trunc(args.units));
  const estimatedCostMicros = args.estimatedCostMicros ?? 0n;
  const config = outboundCommunicationCapConfig();
  const userLimit =
    args.channel === 'email' ? config.emailDailyUserLimit : config.smsDailyUserLimit;
  const orgLimit = args.channel === 'email' ? config.emailDailyOrgLimit : config.smsDailyOrgLimit;
  const costLimit = args.channel === 'sms' ? config.smsDailyOrgCostCapMicros : 0n;
  const keys = keysFor(args.channel, args.orgId, args.userId);

  try {
    if (!(await ensureRedisReady())) {
      throw new Error('Redis is not ready');
    }

    const result = await redis.eval(
      RESERVE_SCRIPT,
      3,
      keys.userCountKey,
      keys.orgCountKey,
      keys.orgCostKey,
      String(units),
      String(estimatedCostMicros),
      String(userLimit),
      String(orgLimit),
      String(costLimit),
      String(UTC_DAY_TTL_SECONDS),
    );
    const [allowed, reason, , limit] = normalizeEvalResult(result);

    if (allowed !== 1) {
      throw new OutboundCommunicationLimitError(limitMessage(args.channel, reason, limit));
    }
  } catch (err) {
    if (err instanceof OutboundCommunicationLimitError) throw err;
    if (err instanceof OutboundCommunicationCapUnavailableError) throw err;

    if (outboundCapRedisRequired()) {
      throw new OutboundCommunicationCapUnavailableError(
        'Outbound communication caps are unavailable; Redis is required for this environment.',
      );
    }

    log.warn({ err }, 'outbound communication cap check unavailable; allowing request');
    return { channel: args.channel, rollback: async () => {} };
  }

  return {
    channel: args.channel,
    rollback: async () => {
      try {
        const pipeline = redis.pipeline();
        pipeline.decrby(keys.userCountKey, units);
        pipeline.expire(keys.userCountKey, UTC_DAY_TTL_SECONDS);
        pipeline.decrby(keys.orgCountKey, units);
        pipeline.expire(keys.orgCountKey, UTC_DAY_TTL_SECONDS);
        if (estimatedCostMicros > 0n) {
          pipeline.decrby(keys.orgCostKey, Number(estimatedCostMicros));
          pipeline.expire(keys.orgCostKey, UTC_DAY_TTL_SECONDS);
        }
        await pipeline.exec();
      } catch (err) {
        log.warn({ err }, 'outbound communication cap rollback failed');
      }
    },
  };
}
