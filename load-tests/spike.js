/**
 * k6 spike test — BidStack 360° API
 *
 * Profile: rapid ramp 0 → 2000 VUs over 30 s, sustain 5 min, ramp down 30 s.
 * WHY: validates the API does not crash under sudden traffic spikes (e.g., large
 * campaign launch or batch import triggering concurrent requests).
 *
 * Success criteria:
 *   - Server does not return 5xx during sustained phase (error rate < 1%)
 *   - p99 response time < 2000ms during sustained phase
 *   - No OOM / process crash (external monitoring)
 *
 * Usage:
 *   k6 run --env API_BASE_URL=https://api.bidstack.io --env AUTH_TOKEN=... load-tests/spike.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('spike_error_rate');
const latency = new Trend('spike_latency', true);

const BASE_URL = __ENV.API_BASE_URL || 'http://localhost:4000';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || 'dev-stub-token';

const HEADERS = {
  Authorization: `Bearer ${AUTH_TOKEN}`,
  Accept: 'application/json',
};

export const options = {
  stages: [
    // Rapid ramp — simulate sudden spike
    { duration: '30s', target: 2000 },
    // Sustained high load
    { duration: '5m', target: 2000 },
    // Cool down
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    // Allow higher error rate during ramp (rate limiters may kick in)
    // but sustained phase should remain healthy
    spike_error_rate: ['rate<0.01'],
    spike_latency: ['p(99)<2000'],
    // HTTP errors — 429 (rate limit) are expected; 5xx are not
    'http_req_failed': ['rate<0.01'],
  },
};

export default function () {
  // Distribute across all three endpoints for realistic spike
  const endpoints = ['/api/v1/leads', '/api/v1/contacts', '/api/v1/opportunities'];
  const url = `${BASE_URL}${endpoints[Math.floor(Math.random() * endpoints.length)]}?limit=10`;

  const res = http.get(url, { headers: HEADERS });

  const ok = check(res, {
    'not 5xx': (r) => r.status < 500,
    // 429 rate limit is acceptable; 5xx is not
    'no server error': (r) => r.status !== 500 && r.status !== 503,
  });

  latency.add(res.timings.duration);
  errorRate.add(!ok);

  // No sleep — maximum concurrency is the point of a spike test
}
