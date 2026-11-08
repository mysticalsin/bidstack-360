import { describe, expect, it, vi } from 'vitest';

vi.mock('bullmq', () => ({
  Queue: class {
    add = vi.fn();
  },
}));

const { makeConnection } = await import('./email-outlook');

describe('outlook email queue connection', () => {
  it('keeps the Redis password from REDIS_URL', () => {
    expect(makeConnection('redis://:s3cret@polo-redis:6379')).toEqual({
      host: 'polo-redis',
      port: 6379,
      password: 's3cret',
    });
  });

  it('keeps username and TLS for managed Redis', () => {
    expect(makeConnection('rediss://default:p%40ss@cache.example.com:6380')).toEqual({
      host: 'cache.example.com',
      port: 6380,
      username: 'default',
      password: 'p@ss',
      tls: {},
    });
  });

  it('stays bare for a local Redis without auth', () => {
    expect(makeConnection('redis://localhost:6380')).toEqual({ host: 'localhost', port: 6380 });
  });
});
