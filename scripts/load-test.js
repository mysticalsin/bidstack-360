/**
 * k6 load-test script for BidStack 360° API.
 *
 * Scenarios:
 * 1. Login + Dashboard load (simulated via health + CRM dashboard)
 * 2. Opportunity list pagination
 * 3. Search endpoints
 *
 * Thresholds:
 * - p95 latency < 500ms
 * - Error rate < 1%
 *
 * Usage:
 *   k6 run scripts/load-test.js
 *
 * Environment variables:
 *   API_BASE_URL  - default: http://localhost:4000
 *   K6_DURATION_PROFILE - smoke | full | baseline | stress | soak | certification.
 *   API_TOKEN     - Bearer token for authenticated routes. If omitted, the
 *                   script still exercises authenticated routes, which is the
 *                   expected local/dev-stub mode.
 *   BIDSTACK_LOAD_ROLE - Optional E2E stub role header when the API enables it.
 *   SKIP_AUTHENTICATED_ROUTES=true - health-only smoke mode.
 *   K6_P95_MS / K6_FAILURE_RATE / K6_CHECK_RATE - optional threshold overrides.
 */

/* global __ENV, __ITER, __VU, console */

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.API_BASE_URL || 'http://localhost:4000';
const TOKEN = __ENV.API_TOKEN || '';
const SKIP_AUTHENTICATED_ROUTES = __ENV.SKIP_AUTHENTICATED_ROUTES === 'true';
const STUB_ROLE = __ENV.BIDSTACK_LOAD_ROLE || '';
const DURATION_PROFILE = __ENV.K6_DURATION_PROFILE || 'full';
const P95_MS = Number(__ENV.K6_P95_MS || '500');
const FAILURE_RATE = Number(__ENV.K6_FAILURE_RATE || '0.01');
const CHECK_RATE = Number(__ENV.K6_CHECK_RATE || '0.99');
const PROFILES = {
  smoke: [
    { duration: '5s', target: 5 },
    { duration: '5s', target: 0 },
  ],
  full: [
    { duration: '30s', target: 10 },
    { duration: '1m', target: 50 },
    { duration: '30s', target: 100 },
    { duration: '30s', target: 0 },
  ],
  baseline: [
    { duration: '1m', target: 50 },
    { duration: '3m', target: 50 },
    { duration: '1m', target: 0 },
  ],
  stress: [
    { duration: '2m', target: 100 },
    { duration: '3m', target: 250 },
    { duration: '2m', target: 500 },
    { duration: '2m', target: 0 },
  ],
  soak: [
    { duration: '2m', target: 100 },
    { duration: '30m', target: 100 },
    { duration: '2m', target: 0 },
  ],
  certification: [
    { duration: '2m', target: 250 },
    { duration: '5m', target: 250 },
    { duration: '2m', target: 500 },
    { duration: '5m', target: 500 },
    { duration: '2m', target: 0 },
  ],
};
const STAGES = PROFILES[DURATION_PROFILE] || PROFILES.full;

const headers = {
  'Content-Type': 'application/json',
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
  ...(STUB_ROLE ? { 'x-bidstack-e2e-role': STUB_ROLE } : {}),
};

export const options = {
  stages: STAGES,
  thresholds: {
    http_req_duration: [`p(95)<${P95_MS}`],
    http_req_failed: [`rate<${FAILURE_RATE}`],
    checks: [`rate>${CHECK_RATE}`],
  },
};

function ok(res, name) {
  check(res, {
    [`${name} status 2xx`]: (r) => r.status >= 200 && r.status < 300,
    [`${name} latency < ${P95_MS}ms`]: (r) => r.timings.duration < P95_MS,
  });
}

function okOrRateLimited(res, name) {
  check(res, {
    [`${name} status 2xx or graceful 429`]: (r) =>
      (r.status >= 200 && r.status < 300) || r.status === 429,
    [`${name} latency < ${P95_MS}ms`]: (r) => r.timings.duration < P95_MS,
  });
}

export default function () {
  // 1. Health check (public)
  const health = http.get(`${BASE}/readyz`);
  ok(health, 'health');
  sleep(1);

  if (SKIP_AUTHENTICATED_ROUTES) {
    if (__VU === 1 && __ITER === 0) {
      console.log('SKIP_AUTHENTICATED_ROUTES=true; skipping authenticated routes.');
    }
    return;
  }

  if (!TOKEN && __VU === 1 && __ITER === 0) {
    console.log('No API_TOKEN provided; using local dev-stub auth. Production runs must pass API_TOKEN.');
  }

  // 2. Dashboard load (LCP-critical path)
  const dashboard = http.get(`${BASE}/api/v1/crm/dashboard`, { headers });
  ok(dashboard, 'dashboard');
  sleep(1);

  // 3. Opportunity list pagination
  const opps = http.get(`${BASE}/api/v1/opportunities?limit=25`, { headers });
  ok(opps, 'opportunities_list');
  sleep(1);

  // 4. Search endpoints
  const search = http.get(`${BASE}/api/v1/search?q=test&limit=10`, {
    headers,
    // Local load uses one dev-stub user/IP; the search route intentionally caps
    // sustained autocomplete abuse and answers 429. Treat that as graceful, not
    // as an infrastructure failure.
    responseCallback: http.expectedStatuses({ min: 200, max: 299 }, 429),
  });
  okOrRateLimited(search, 'search');
  sleep(1);

  // 5. CRM summary (lightweight KPI data)
  const summary = http.get(`${BASE}/api/v1/crm/summary`, { headers });
  ok(summary, 'crm_summary');
  sleep(1);
}
