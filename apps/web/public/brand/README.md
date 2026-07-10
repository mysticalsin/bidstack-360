# Brand assets — Polo PreSales

The canonical logo is delivered as **inline SVG** by the React `PoloPreSalesLogo`
component (`apps/web/src/components/brand/PoloPreSalesLogo.tsx`). Because it is
vector, it stays crisp at every size, inherits the page font, and adapts to
light/dark via the `tone` prop — no raster round-trip required. The standalone
SVG files below exist for surfaces that need a plain asset URL (email, OG,
external docs).

| Slot                        | File (this directory)      | Used by                                    |
| --------------------------- | -------------------------- | ------------------------------------------ |
| Full lockup (mark + word)   | `polo-presales-logo.svg`   | Static/email/OG use; component for in-app  |
| Mark only (transparent)     | `polo-presales-mark.svg`   | Compact placements, favicons               |
| App icon (gradient square)  | `/icon.svg`, `/icon-*.png` | Browser tab, PWA, apple-touch              |

## Palette

These are the brand hex values baked into the logo SVG/component. They are **not**
CSS variables — the live UI accent is driven by `--brand-primary` (see below).

| Color   | Hex       | Role                                        |
| ------- | --------- | ------------------------------------------- |
| Ink     | `#0A0A2E` | "Polo" wordmark, headings                   |
| Violet  | `#7A1FD6` | "PreSales" wordmark, primary accent (light) |
| Indigo  | `#3F16E8` | Gradient start (mark)                       |
| Magenta | `#E4069F` | Gradient end / signal dots (accent only)    |

The mark gradient runs indigo → violet → magenta. Violet clears WCAG AA
(~7.0:1 on white); magenta is an accent/large-text color only (4.35:1).
Dark mode lifts the accent to `#8B6DFF`. The live UI accent is driven by
`--brand-primary` in `apps/web/src/index.css`.

## Regenerating raster derivatives

Icons and the OG card are rasterized from the SVGs via headless Chrome; the
generator scripts live in the branding scratchpad. Mirror the SVGs into
`apps/marketing/public/brand/` for the marketing site (the two apps deploy
independently, so they are copied rather than symlinked).

Assets (favicon, marketing OG card) were regenerated 2026-07-09 from the
outlined mark/wordmark source (`PoloPreSalesLogo.tsx`'s `MARK_PATH` /
`POLO_WORD_PATH` / `PRESALES_WORD_PATH`) — no font-file dependency at
render time.
