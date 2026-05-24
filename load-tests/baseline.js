/**
 * k6 baseline load test — BidStack 360° API
 *
 * Profile: 100 VUs sustained for 5 minutes.
 * Targets the three highest-traffic list endpoints.
 *
 * Success criteria:
 *   - p95 response time < 100ms
 *   - Error rate < 0.1%
 *
 * Usage:
 *   k6 run --env API_BASE_URL=https://api.bidstack.io --env AUTH_TOKEN=... load-tests/baseline.js
 *
 * See load-tests/README.md for full setup instructions.
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// ── Custom metrics ─────────────────────────────────────────────────────────

const errorRate = new Rate('custom_error_rate');
const leadsLatency = new Trend('leads_latency', true);
const contactsLatency = new Trend('contacts_latency', true);
const opportunitiesLatency = new Trend('opportunities_latency', true);
const totalRequests = new Counter('custom_requests_total');

// ── Config ─────────────────────────────────────────────────────────────────

const BASE_URL = __ENV.API_BASE_URL || 'http://localhost:4000';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || 'dev-stub-token';
const ORG_ID = __ENV.ORG_ID || '';

const HEADERS = {
  Authorization: `Bearer ${AUTH_TOKEN}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
  ...(ORG_ID ? { 'X-Org-Id': ORG_ID } : {}),
};

// ── Thresholds ─────────────────────────────────────────────────────────────

export const options = {
  vus: 100,
  duration: '5m',
  thresholds: {
    // p95 across all requests must be under 100ms
    http_req_duration: ['p(95)<100'],
    // Error rate must stay below 0.1%
    custom_error_rate: ['rate<0.001'],
    // Per-endpoint p95
    leads_latency: ['p(95)<100'],
    contacts_latency: ['p(95)<100'],
    opportunities_latency: ['p(95)<100'],
  },
};

// ── Virtual user scenario ──────────────────────────────────────────────────

export default function () {
  group('leads list', () => {
    const res = http.get(`${BASE_URL}/api/v1/leads?limit=20&page=1`, { headers: HEADERS });
    const ok = check(res, {
      'leads 200': (r) => r.status === 200,
      'leads has data': (r) => {
        try {
          const body = JSON.parse(r.body);
          return Array.isArray(body.data) || Array.isArray(body);
        } catch {
          return false;
        }
      },
    });
    leadsLatency.add(res.timings.duration);
    errorRate.add(!ok);
    totalRequests.add(1);
  });

  sleep(0.1);

  group('contacts list', () => {
    const res = http.get(`${BASE_URL}/api/v1/contacts?limit=20&page=1`, { headers: HEADERS });
    const ok = check(res, {
      'contacts 200': (r) => r.status === 200,
    });
    contactsLatency.add(res.timings.duration);
    errorRate.add(!ok);
    totalRequests.add(1);
  });

  sleep(0.1);

  group('opportunities list', () => {
    const res = http.get(`${BASE_URL}/api/v1/opportunities?limit=20&page=1`, { headers: HEADERS });
    const ok = check(res, {
      'opportunities 200': (r) => r.status === 200,
    });
    opportunitiesLatency.add(res.timings.duration);
    errorRate.add(!ok);
    totalRequests.add(1);
  });

  sleep(0.2);
}
