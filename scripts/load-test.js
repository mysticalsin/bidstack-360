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
 *   API_TOKEN     - Bearer token for authenticated routes
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.API_BASE_URL || 'http://localhost:4000';
const TOKEN = __ENV.API_TOKEN || '';

const headers = {
  'Content-Type': 'application/json',
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

export const options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '1m', target: 50 },
    { duration: '30s', target: 100 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

function ok(res, name) {
  check(res, {
    [`${name} status 2xx`]: (r) => r.status >= 200 && r.status < 300,
    [`${name} p95 < 500ms`]: (r) => r.timings.duration < 500,
  });
}

export default function () {
  // 1. Health check (public)
  const health = http.get(`${BASE}/readyz`);
  ok(health, 'health');
  sleep(1);

  if (!TOKEN) {
    console.log('No API_TOKEN provided; skipping authenticated routes.');
    return;
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
  const search = http.get(`${BASE}/api/v1/search?q=test&limit=10`, { headers });
  ok(search, 'search');
  sleep(1);

  // 5. CRM summary (lightweight KPI data)
  const summary = http.get(`${BASE}/api/v1/crm/summary`, { headers });
  ok(summary, 'crm_summary');
  sleep(1);
}
