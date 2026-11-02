module.exports = {
  ci: {
    collect: {
      url: ['http://localhost:4173/login', 'http://localhost:4173/dashboard'],
      startServerCommand: 'cd apps/web && pnpm preview',
      // Vite *preview* prints "Local: http://localhost:4173/", not the
      // dev-server "ready in" line. Matching the wrong pattern made LHCI
      // audit before paint and fail with NO_FCP.
      startServerReadyPattern: 'Local:',
      startServerReadyTimeout: 60000,
      numberOfRuns: 3,
      settings: {
        chromeFlags: '--no-sandbox --headless --disable-dev-shm-usage',
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
