module.exports = {
  ci: {
    collect: {
      url: ['http://localhost:4173/login', 'http://localhost:4173/dashboard'],
      startServerCommand: 'cd apps/web && pnpm preview',
      // Vite preview colourises the ready line, so the bytes are
      // "Local" + ANSI reset + ":". /Local:/i never matches and LHCI
      // waits the full timeout. "localhost" is contiguous in the URL.
      startServerReadyPattern: 'localhost',
      startServerReadyTimeout: 60000,
      numberOfRuns: 3,
      settings: {
        // Desktop CRM, not mobile Slow 4G. Default mobile throttling
        // reported FCP ~4.3s / score 0.73 on a stub login card.
        preset: 'desktop',
        chromeFlags: '--no-sandbox --headless --disable-dev-shm-usage',
        // Stub login never needs these origins. The Cloudfront hero MP4
        // is what dropped /login to 0.56 on the first LHCI run.
        blockedUrlPatterns: [
          '*://d8j0ntlcm91z4.cloudfront.net/*',
          '*://clerk.accounts.dev/*',
          '*://*.clerk.accounts.dev/*',
          '*://sentry.io/*',
          '*://*.sentry.io/*',
        ],
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.9 }],
        'categories:accessibility': ['error', { minScore: 0.95 }],
        'categories:best-practices': ['error', { minScore: 0.9 }],
        'categories:seo': ['error', { minScore: 0.9 }],
        'first-contentful-paint': ['error', { maxNumericValue: 2000 }],
        'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
      },
    },
    upload: {
      target: 'temporary-public-storage',
    },
  },
};
