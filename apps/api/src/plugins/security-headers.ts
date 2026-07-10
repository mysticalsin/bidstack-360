/**
 * Security headers plugin — supplemental hardening on top of @fastify/helmet.
 *
 * WHY: @fastify/helmet covers most OWASP headers, but CSP and
 * Permissions-Policy live here as the single auditable source of truth. Keeping
 * a second CSP in server.ts drifted silently because this onSend hook overwrote
 * Helmet's value.
 *
 * Header rationale (per OWASP Secure Headers Project):
 *
 *   CSP             — controls which resources the browser can load.
 *                     'unsafe-inline' is permitted on script-src in dev (Vite HMR).
 *                     fonts.googleapis.com allowed for style-src (web fonts).
 *   HSTS            — forces HTTPS for 1 year. preload enables HSTS preload list submission.
 *                     Set to production-only (dev uses HTTP).
 *   X-Frame-Options — prevents clickjacking. DENY is stricter than SAMEORIGIN.
 *   X-Content-Type  — prevents MIME-type sniffing.
 *   Referrer-Policy — limits referrer information on cross-origin navigations.
 *   Permissions-Policy — disables sensors/APIs this app does not use.
 *   COOP            — isolates the browsing context to prevent cross-origin attacks.
 *   connect-src wss — allows WebSocket connections for real-time collaboration.
 */

import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

// Adjust these origins for your deployment.
const BIDSTACK_DOMAINS = ['https://*.bidstack.io'];
const CONNECT_SRC = [
  "'self'",
  'wss:',
  ...BIDSTACK_DOMAINS,
  'https://api.clerk.com',
  'https://*.clerk.accounts.dev',
  'https://dust.tt',
  'https://*.dust.tt',
  'https://*.sentry.io',
  'https://api.apollo.io',
  'https://api.zoom.us',
  'https://zoom.us',
  'https://api.deepgram.com',
  'https://graph.microsoft.com',
  'https://www.googleapis.com',
  'https://api.twilio.com',
];

export const buildContentSecurityPolicy = (isDev: boolean): string => {
  const parts: string[] = [
    "default-src 'self'",
    // WHY 'unsafe-inline' in dev: Vite injects inline scripts for HMR.
    // Production removes it — rely on hash/nonce if inline scripts are needed.
    isDev
      ? "script-src 'self' 'unsafe-inline'"
      : "script-src 'self' 'sha256-zMrO0O5IHYc57MwPohPXPYLWREEfnFUG550rxUn/8RA='",
    // Google Fonts stylesheet is loaded by the design system.
    "style-src 'self' 'unsafe-inline' fonts.googleapis.com",
    "font-src 'self' fonts.gstatic.com",
    // data: for inline images (charts, thumbnails). https: for third-party embeds.
    "img-src 'self' data: https:",
    // wss: for real-time WebSocket connections.
    `connect-src ${CONNECT_SRC.join(' ')}`,
    "object-src 'none'",
    "frame-src 'self' https://*.clerk.accounts.dev https://challenges.cloudflare.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "worker-src 'self'",
    "media-src 'none'",
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ];
  return parts.join('; ');
};

const PERMISSIONS_POLICY =
  'camera=(), microphone=(), geolocation=(), payment=(), usb=(), ' +
  'magnetometer=(), gyroscope=(), accelerometer=()';

export const securityHeadersPlugin: FastifyPluginAsync = fp(
  async (server) => {
    const isProd = process.env.NODE_ENV === 'production';
    const isDev = !isProd;

    server.addHook('onSend', async (_req, reply) => {
      // Content-Security-Policy
      reply.header('Content-Security-Policy', buildContentSecurityPolicy(isDev));

      // HSTS — production only (dev uses HTTP)
      if (isProd) {
        reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
      }

      // Clickjacking prevention
      reply.header('X-Frame-Options', 'DENY');

      // MIME sniffing prevention
      reply.header('X-Content-Type-Options', 'nosniff');

      // Referrer leak prevention
      reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');

      // Permissions-Policy (removed from @fastify/helmet@12)
      reply.header('Permissions-Policy', PERMISSIONS_POLICY);

      // Cross-Origin-Opener-Policy — prevents cross-origin window opener access
      reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    });
  },
  {
    name: 'security-headers',
    // Must run after @fastify/helmet so our headers override helmet's where needed.
    dependencies: [],
  },
);
