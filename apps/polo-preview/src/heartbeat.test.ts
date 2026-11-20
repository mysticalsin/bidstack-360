import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHeartbeat, reconnectDelayMs } from './heartbeat.js';

describe('box relay heartbeat', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('pings on an interval and keeps a socket that answers', () => {
    const send = vi.fn();
    const terminate = vi.fn();
    const hb = createHeartbeat({ send, terminate, intervalMs: 20_000, timeoutMs: 45_000 });
    hb.start();

    vi.advanceTimersByTime(20_000);
    expect(send).toHaveBeenCalledWith('ping');
    hb.onPong();
    vi.advanceTimersByTime(40_000);
    hb.onPong();
    vi.advanceTimersByTime(40_000);

    expect(terminate).not.toHaveBeenCalled();
    hb.stop();
  });

  it('terminates a half-open socket that stops answering, so the relay reconnects', () => {
    const terminate = vi.fn();
    const hb = createHeartbeat({ send: vi.fn(), terminate, intervalMs: 20_000, timeoutMs: 45_000 });
    hb.start();

    vi.advanceTimersByTime(60_000);

    expect(terminate).toHaveBeenCalledTimes(1);
    hb.stop();
  });

  it('treats any inbound frame as proof of life', () => {
    const terminate = vi.fn();
    const hb = createHeartbeat({ send: vi.fn(), terminate, intervalMs: 20_000, timeoutMs: 45_000 });
    hb.start();
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(20_000);
      hb.onPong();
    }
    expect(terminate).not.toHaveBeenCalled();
    hb.stop();
  });

  it('stops pinging after stop()', () => {
    const send = vi.fn();
    const hb = createHeartbeat({ send, terminate: vi.fn(), intervalMs: 1_000, timeoutMs: 5_000 });
    hb.start();
    hb.stop();
    vi.advanceTimersByTime(10_000);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('reconnect backoff', () => {
  it('grows from 1s and caps at 30s', () => {
    expect(reconnectDelayMs(0)).toBe(1_000);
    expect(reconnectDelayMs(1)).toBe(2_000);
    expect(reconnectDelayMs(3)).toBe(8_000);
    expect(reconnectDelayMs(10)).toBe(30_000);
  });
});
