# Offline-safe brand assets

## Symptom

Healthy CRM pages show console errors or failed resources because fonts, favicons, or logos are fetched from third-party hosts at runtime.

## Cause

Brand polish was implemented through browser-side external requests. Enterprise networks, offline demos, privacy tools, or CSP can block those calls and make the app look broken even when the API is healthy.

## Fix

- Use system font stacks or bundled/self-hosted fonts for the application shell.
- Render company logos only when the URL is same-origin, proxied, blob, or a safe raster data image.
- Use deterministic local initials or monogram badges for unknown companies and technologies.
- Do not synthesize Google favicon URLs in UI components.

## Verification

- Browser route sweeps report zero failed font, favicon, or logo requests.
- Component tests reject remote logo URLs and confirm initials/monogram fallbacks.
- Production Vite build completes without reintroducing external font preload tags.
