// Real-time pub/sub service.
//
// WHY Redis Pub/Sub: BullMQ already uses Redis, and Pub/Sub gives us
// cross-instance fanout without adding a second broker. Any API instance
// can publish; all instances with subscribers receive.
//
// Two Redis connections are required:
//   - `pub`  — dedicated publisher connection (can't subscribe while publishing in cluster mode)
//   - `sub`  — dedicated subscriber connection

import Redis from 'ioredis';
import { pino } from 'pino';

const logger = pino({ name: 'realtime.service' });

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6380';

// Publisher connection — shared, stateless.
const pub = new Redis(redisUrl, {
  connectTimeout: 1_000,
  enableOfflineQueue: true,
  maxRetriesPerRequest: null,
  retryStrategy: (times) => Math.min(times * 200, 5_000),
  lazyConnect: false,
});

pub.on('error', (err: Error) => {
  logger.error({ err }, 'realtime pub connection error');
});

// Subscriber connection — stateful (subscriptions live here).
const sub = new Redis(redisUrl, {
  connectTimeout: 1_000,
  enableOfflineQueue: true,
  maxRetriesPerRequest: null,
  retryStrategy: (times) => Math.min(times * 200, 5_000),
  lazyConnect: false,
});

sub.on('error', (err: Error) => {
  logger.error({ err }, 'realtime sub connection error');
});

type MessageHandler = (payload: RealtimePayload) => void;

/** The envelope every real-time message is wrapped in. */
export interface RealtimePayload {
  channel: string;
  type: string;
  data: unknown;
  ts: number; // Unix ms — clients use this for ordering
}

// In-process handler registry: channel → Set<handler>
// The sub connection fires sub.on('message') which fans out to these handlers.
const handlers = new Map<string, Set<MessageHandler>>();

sub.on('message', (channel: string, raw: string) => {
  const set = handlers.get(channel);
  if (!set || set.size === 0) return;

  let payload: RealtimePayload;
  try {
    payload = JSON.parse(raw) as RealtimePayload;
  } catch (err) {
    logger.warn({ channel, err }, 'non-JSON realtime message ignored');
    return;
  }

  for (const handler of set) {
    try {
      handler(payload);
    } catch (err) {
      logger.error({ channel, err }, 'realtime message handler threw');
    }
  }
});

/**
 * Publish a message to a channel.
 * All API instances subscribed to the channel will receive it.
 */
export async function publish(channel: string, type: string, data: unknown): Promise<void> {
  const payload: RealtimePayload = { channel, type, data, ts: Date.now() };
  const raw = JSON.stringify(payload);
  await pub.publish(channel, raw);
}

/**
 * Subscribe in-process to a Redis Pub/Sub channel.
 * Returns an unsubscribe function.
 */
export function subscribe(channel: string, handler: MessageHandler): () => void {
  if (!handlers.has(channel)) {
    handlers.set(channel, new Set());
    // Tell Redis we want messages for this channel.
    sub.subscribe(channel).catch((err) => {
      logger.error({ channel, err }, 'failed to subscribe to channel');
    });
  }

  handlers.get(channel)!.add(handler);

  return () => {
    const set = handlers.get(channel);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) {
      handlers.delete(channel);
      sub.unsubscribe(channel).catch((err) => {
        logger.warn({ channel, err }, 'failed to unsubscribe from channel');
      });
    }
  };
}

/** Graceful shutdown — closes both Redis connections. */
export async function shutdownRealtimeService(): Promise<void> {
  await Promise.all([pub.quit(), sub.quit()]);
}
