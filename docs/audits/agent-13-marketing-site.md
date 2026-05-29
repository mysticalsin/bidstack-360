# Agent 13 — Marketing Site Domain Audit

**Scope:** `apps/marketing/src/**/*.tsx`, `apps/marketing/index.html`, build config  
**Rubric dimension:** Design 25 + Infra 25  
**Date:** 2026-05-23  
**Auditor:** Read-only static analysis

---

## 1. Score

**72 / 100**

| Dimension | Score | Rationale                                                                                                                                                                       |
| --------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Design    | 19/25 | Strong token system, a11y primitives, dark mode, reduced-motion support. Deducted for broken social-share asset, placeholder footer links, and missing PWA polish.              |
| Infra     | 17/25 | Solid Docker/nginx foundation, code-splitting, sitemap gen. Deducted for missing CSP/HSTS/brotli, pure-CSR SEO risk, no 404 page, and `tsconfig.tsbuildinfo` leaking into dist. |

---

## 2. Strengths

- **FOUC-free theme hydration with full token parity**  
  `index.html:32-42` injects an inline script that reads `localStorage` and applies `data-theme` before first paint. `src/lib/theme.ts` keeps the React hook in sync across tabs. `src/index.css:8-89` defines a comprehensive light/dark design-token layer that mirrors `apps/web` for brand consistency.

- **Accessibility primitives baked into the CSS foundation**  
  `src/index.css:170-237` ships Apple HIG–style focus rings (`outline: 2px solid` + halo), `prefers-reduced-motion` guard (`:178-189`), 44×44 px touch targets (`:192-197`), a skip-link (`:220-237`), and an `sr-only` utility. This is above-average for a marketing surface.

- **Per-route SEO + structured data**  
  `src/lib/seo.ts` provides a lightweight `useSeo` hook that upserts `<title>`, `<meta name="description">`, Open Graph tags, Twitter card, and canonical link on every route change without pulling in `react-helmet`. `src/pages/HomePage.tsx:108-144` injects JSON-LD (`Organization` + `SoftwareApplication`) for rich snippets.

- **Performance-oriented bundle strategy**  
  `vite.config.ts:39-67` enables `cssCodeSplit`, `reportCompressedSize`, and aggressive `manualChunks` (react, react-dom, router, vendor). Secondary routes are lazy-loaded in `App.tsx:11-19`, keeping the landing-page initial chunk small. Google Fonts are preconnected (`index.html:9-10`).

- **Semantic, zero-JS accordion pattern**  
  `src/index.css:528-567` styles native `<details>/<summary>` for the FAQ, which is keyboard-navigable and screen-reader friendly without React state. `PricingPage.tsx:421-425` and `HomePage.tsx` leverage this pattern correctly.

---

## 3. P0 Gaps

> SEO failures, accessibility violations, broken navigation

### 3.1 Broken Open Graph image reference

**File:** `apps/marketing/index.html:28`

```html
<meta property="og:image" content="https://bidstack.dev/og/og-default.png" />
```

The file on disk is `public/og/og-default.svg` (and `dist/og/og-default.svg`). Facebook, LinkedIn, and many crawlers will fail to render an OG image because the `.png` extension does not exist. The same mismatch exists in `src/lib/seo.ts:16` where `DEFAULT_OG` also points to `.png`.

### 3.2 Deceptive footer navigation (placeholder links routed to `/`)

**File:** `apps/marketing/src/components/Footer.tsx:10-55`

```ts
{ label: 'Pipeline', to: '/' },
{ label: 'Proposals', to: '/' },
{ label: 'Accounts', to: '/' },
{ label: 'Workflows', to: '/' },
{ label: 'IT services bids', to: '/' },
{ label: 'Government RFPs', to: '/' },
{ label: 'Strategic accounts', to: '/' },
{ label: 'Channel partners', to: '/' },
{ label: 'About', to: '/' },
{ label: 'Careers', to: '/' },
```

Ten distinct labels in the footer all route to the homepage. This is a WCAG 2.4.4 / 3.2.4 violation (link purpose in context) and creates a broken-navigation experience for users expecting distinct pages.

### 3.3 Catch-all route returns 200 OK for missing pages

**File:** `apps/marketing/src/App.tsx:52-54`

```tsx
<Route path="*" element={<HomePage />} />
```

Unknown paths (e.g., `/blog`, `/contact`) render the homepage with an HTTP 200. This harms SEO (soft-404 penalty) and confuses users. The nginx fallback (`nginx.conf:53-55`) compounds the issue by serving `index.html` for all unknown routes.

### 3.4 Mobile menu lacks focus trap

**File:** `apps/marketing/src/components/NavBar.tsx:142-169`  
When the mobile menu is open, pressing `Tab` cycles focus into the underlying page content. The `Escape` handler closes the menu, but without a focus trap or `inert` attribute on the rest of the DOM, keyboard users can navigate behind the open overlay—a WCAG 2.4.3 failure.

---

## 4. P1 Gaps

> Performance, responsive issues, missing meta tags

### 4.1 Pure CSR SPA harms route-level SEO

All meta tags for `/pricing`, `/legal/privacy`, etc. are injected client-side via `useSeo`. Googlebot can execute JS, but secondary crawlers (Bing, social scrapers, Perplexity) may index the homepage metadata for every URL. The site needs SSR, prerender (e.g. `vite-plugin-ssg`), or a pre-rendered lambda to guarantee correct meta tags at the HTTP level.

### 4.2 Missing `og:image:width`, `og:image:height`, and `twitter:*` specificity

**File:** `apps/marketing/index.html:20-30`, `src/lib/seo.ts:38-49`  
No `og:image:width` / `og:image:height` tags are present, which prevents some platforms from reserving layout space and can hurt CLS on shared previews. Twitter-specific `twitter:title`, `twitter:description`, and `twitter:site` are absent.

### 4.3 No Content-Security-Policy, HSTS, or brotli compression in nginx

**File:** `apps/marketing/nginx.conf`  
The comment on line 37 claims a "tight CSP" but no `add_header Content-Security-Policy` directive exists. `X-Content-Type-Options`, `X-Frame-Options`, and `Referrer-Policy` are present, but HSTS (`Strict-Transport-Security`) is missing. Brotli is mentioned in the file header comment but only `gzip` is configured (`:8-11`).

### 4.4 `tsconfig.tsbuildinfo` deployed to dist

**File:** `apps/marketing/dist/tsconfig.tsbuildinfo` (186 KB)  
The build output includes `tsconfig.tsbuildinfo`, which is a build artifact that should not be served publicly. It bloats the Docker image and leaks internal path info.

### 4.5 Group-open rotation class missing parent `group`

**File:** `apps/marketing/src/pages/PricingPage.tsx:359`

```tsx
<Icon.ArrowRight width={18} height={18} className="rotate-90 group-open:rotate-[270deg]" />
```

The `<details>` parent does not have `className="group"`, so the `group-open:` variant will never fire. The expand/collapse arrow stays static—a minor responsive/UI bug.

### 4.6 No `aria-current` on active navigation links

**File:** `apps/marketing/src/components/NavBar.tsx:30-35`  
The `linkClass` helper colors the active link but never sets `aria-current="page"`, so screen-reader users cannot identify which page is active.

### 4.7 No resource hints for external CTAs

Multiple links target `https://app.bidstack.dev` and `https://cal.com/bidstack/demo` (`HomePage.tsx:173,178`, `PricingPage.tsx`), yet there is no `<link rel="dns-prefetch">` or `<link rel="preconnect">` for those origins. On slower networks, the CTA click feels sluggish.

### 4.8 Font loading is render-blocking

**File:** `apps/marketing/index.html:11-14`  
The Google Fonts `<link>` does not use `media="print"` swap or `fetchpriority="high"` heuristics. While `display=swap` is present in the URL, the CSS file itself still blocks the HTML parser. Consider inlining the `@font-face` declarations or self-hosting subsetted fonts.

---

## 5. P2 Gaps

> Nice-to-have improvements

### 5.1 No JSON-LD on secondary pages

`PricingPage`, `DPAPage`, `PrivacyPage`, `SecurityPage`, and `TermsPage` have no structured data. `SoftwareApplication` + `Offer` schema on `/pricing` would improve rich-snippet eligibility.

### 5.2 No `manifest.json` or PWA support

No web app manifest, service worker, or `apple-touch-icon` is present. The site cannot be installed or launched standalone from a home screen.

### 5.3 Social-proof section is text-only placeholders

**File:** `apps/marketing/src/pages/HomePage.tsx:204-214`  
The "Trusted by" grid renders brand names as styled text (`Amaris`, `LittleBig`, etc.) rather than actual logos. For a production marketing site, this looks unfinished.

### 5.4 CTA banner uses hardcoded hex values

**File:** `apps/marketing/src/pages/HomePage.tsx:466-468`

```tsx
style={{
  background:
    'linear-gradient(135deg, #1b2c7a 0%, #2c4bff 50%, #6e59ff 100%)',
}}
```

The gradient bypasses the CSS custom properties (`--brand-gradient`, `--brand-deep`), breaking dark-mode consistency if the token values ever drift.

### 5.5 No `hreflang` or alternate language tags

The site is English-only but lacks `<link rel="alternate" hreflang="en">`, which is a signal some international crawlers expect.

### 5.6 No intersection-observer lazy-rendering for below-fold sections

`HomePage.tsx` renders all sections eagerly. While the DOM is not massive, an `IntersectionObserver`-based wrapper could defer hydration of the testimonials and comparison table on low-end devices.

### 5.7 No dead-link checker or visual regression in CI

The `package.json` scripts include `lint`, `typecheck`, and `test`, but there is no Lighthouse CI, Playwright smoke test, or link-checker step for the marketing domain.

---

## 6. Evidence

### Build output analysis

```
dist/assets/index-B4NzezeR.js      32,316 B
/dist/assets/react-CM78XA16.js     12,473 B
/dist/assets/react-dom-C38VTdgd.js 130,395 B
/dist/assets/router-EqT7xWRs.js    22,146 B
/dist/assets/vendor-B-dksMZM.js       374 B
/dist/assets/index-DhlkpoQU.css    33,933 B
```

The JS budget is within the 100 KB gzipped target for the entry chunk, but `react-dom` at ~130 KB is the dominant payload. No `rollup-plugin-visualizer` is configured to track this over time.

### OG image mismatch

```html
<!-- index.html:28 -->
<meta property="og:image" content="https://bidstack.dev/og/og-default.png" />
```

```bash
$ ls apps/marketing/public/og/
og-default.svg   # <-- .svg, not .png
```

### Missing security headers in nginx

```nginx
# nginx.conf:39-42 — present
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;

# nginx.conf — ABSENT
# add_header Strict-Transport-Security "max-age=63072000" always;
# add_header Content-Security-Policy "default-src 'self' ..." always;
```

### Footer link map (all pointing to `/`)

```tsx
// Footer.tsx:10-55 excerpt
[
  { title: 'Product', links: ['Pipeline', 'Proposals', 'Accounts', 'Workflows', 'Pricing'] },
  {
    title: 'Solutions',
    links: ['IT services bids', 'Government RFPs', 'Strategic accounts', 'Channel partners'],
  },
  { title: 'Company', links: ['About', 'Careers', 'Contact'] },
];
// Every link except 'Pricing' and external hrefs routes to '/'.
```

---

## 7. Summary

The BidStack marketing site is a **well-architected, accessibility-conscious SPA** with strong design-token hygiene and a lean bundle strategy. It is clearly built by a team that cares about WCAG compliance and performance budgets.

However, **three P0 issues** threaten its production readiness:

1. The broken OG image reference will cripple social sharing.
2. The placeholder footer links create a deceptive navigation pattern.
3. The catch-all 200-OK fallback hurts SEO and user trust.

Fixing these, plus adding a CSP, HSTS, and a prerender step for route-level meta tags, would bring the score into the **85–90 range**.
