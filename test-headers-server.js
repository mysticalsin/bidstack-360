#!/usr/bin/env node
/**
 * Local test server for security headers
 * 
 * This script serves the built app with the same headers configured in vercel.json
 * to allow local verification before deployment.
 */

import { createServer } from 'http';
import { readFileSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' fonts.googleapis.com; font-src 'self' fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' wss: https://*.bidstack.io https://api.clerk.com https://*.clerk.accounts.dev https://dust.tt https://*.dust.tt https://*.sentry.io https://api.apollo.io https://api.zoom.us https://zoom.us https://api.deepgram.com https://graph.microsoft.com https://www.googleapis.com https://api.twilio.com; object-src 'none'; frame-src 'self' https://*.clerk.accounts.dev https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; worker-src 'self'; media-src 'none'; upgrade-insecure-requests",
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()',
  'Cross-Origin-Opener-Policy': 'same-origin'
};

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const PORT = 8080;
const DIST_DIR = join(__dirname, 'apps', 'web', 'dist');

const server = createServer((req, res) => {
  let filePath = join(DIST_DIR, req.url === '/' ? 'index.html' : req.url);
  
  try {
    const content = readFileSync(filePath);
    const ext = extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    
    res.writeHead(200, {
      'Content-Type': contentType,
      ...HEADERS
    });
    res.end(content);
  } catch (err) {
    if (req.url !== '/') {
      filePath = join(DIST_DIR, 'index.html');
      try {
        const content = readFileSync(filePath);
        res.writeHead(200, {
          'Content-Type': 'text/html',
          ...HEADERS
        });
        res.end(content);
      } catch {
        res.writeHead(404);
        res.end('Not Found');
      }
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  }
});

server.listen(PORT, () => {
  console.log(`\nTest server running at http://localhost:${PORT}/`);
  console.log('\nSecurity headers configured:');
  Object.entries(HEADERS).forEach(([key, value]) => {
    console.log(`  ${key}: ${value.substring(0, 60)}${value.length > 60 ? '...' : ''}`);
  });
  console.log('\nTest with:');
  console.log(`  curl -sI http://localhost:${PORT}/ | grep -E "Content-Security-Policy|X-Frame-Options"`);
});
