/**
 * k6 soak test — BidStack 360° API
 *
 * Profile: 50 VUs for 30 minutes.
 * WHY: sustained low-medium load reveals memory leaks, connection pool exhaustion,
 * and gradual degradation that short tests miss.
 *
 * Success criteria:
 *   - Error rate < 0.1% throughout
 *   - p95 latency stays below 100ms throughout (no gradual drift)
 *   - Memory delta < 10% between first and last 5-min window (external monitoring)
 *
 * Memory monitoring: compare RSS/heap snapshots from your APM (e.g. Datadog,
 * New Relic) at t=0 and t=30m. A > 10% increase indicates a leak.
 *
 * Usage:
 *   k6 run --env API_BASE_URL=https://api.bidstack.io --env AUTH_TOKEN=... load-tests/soak.js
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('soak_error_rate');
const latencyP95 = new Trend('soak_latency', true);
const requestCount = new Counter('soak_requests_total');

const BASE_URL = __ENV.API_BASE_URL || 'http://localhost:4000';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || 'dev-stub-token';

const HEADERS = {
  Authorization: `Bearer ${AUTH_TOKEN}`,
  Accept: 'application/json',
};

export const options = {
  vus: 50,
  duration: '30m',
  thresholds: {
    soak_error_rate: ['rate<0.001'],
    // p95 must stay under 100ms even at t=30m — drift catches leaks
    soak_latency: ['p(95)<100'],
    http_req_duration: ['p(95)<100'],
    'http_req_failed': ['rate<0.001'],
  },
};

export default function () {
  group('leads', () => {
    const res = http.get(`${BASE_URL}/api/v1/leads?limit=20`, { headers: HEADERS });
    check(res, { 'leads ok': (r) => r.status === 200 });
    latencyP95.add(res.timings.duration);
    errorRate.add(res.status >= 400);
    requestCount.add(1);
  });

  sleep(0.3);

  group('contacts', () => {
    const res = http.get(`${BASE_URL}/api/v1/contacts?limit=20`, { headers: HEADERS });
    check(res, { 'contacts ok': (r) => r.status === 200 });
    latencyP95.add(res.timings.duration);
    errorRate.add(res.status >= 400);
    requestCount.add(1);
  });

  sleep(0.3);

  group('opportunities', () => {
    const res = http.get(`${BASE_URL}/api/v1/opportunities?limit=20`, { headers: HEADERS });
    check(res, { 'opportunities ok': (r) => r.status === 200 });
    latencyP95.add(res.timings.duration);
    errorRate.add(res.status >= 400);
    requestCount.add(1);
  });

  // Realistic think time — prevents CPU saturation that masks memory drift
  sleep(1);
}
