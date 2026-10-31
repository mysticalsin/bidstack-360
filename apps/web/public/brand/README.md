# Brand assets — Polo PreSales

The canonical logo is delivered as **inline SVG** by the React `PoloPreSalesLogo`
component (`apps/web/src/components/brand/PoloPreSalesLogo.tsx`). It is a
compass-pin (teal/silver ring, gold four-point star) stacked above the word
"Polo" on a dark navy field. The accessible name stays "Polo PreSales".
Because it is vector, it stays crisp at every size and adapts via the `tone`
prop (`default` is the full-color lockup; `mono` / `inverse` use `currentColor`).
The standalone SVG files below exist for surfaces that need a plain asset URL
(email, OG, external docs).

| Slot                        | File (this directory)      | Used by                                    |
| --------------------------- | -------------------------- | ------------------------------------------ |
| Full lockup (mark + word)   | `polo-presales-logo.svg`   | Static/email/OG use; component for in-app  |
| Mark only (transparent)     | `polo-presales-mark.svg`   | Compact placements, favicons               |
| App icon (gradient square)  | `/icon.svg`, `/icon-*.png` | Browser tab, PWA, apple-touch              |

## Palette

These are the brand hex values baked into the logo SVG/component. They are **not**
CSS variables — the live UI accent is driven by `--brand-primary` (see below).

| Color | Hex       | Role                                      |
| ----- | --------- | ----------------------------------------- |
| Navy  | `#071422` | Lockup field and star center              |
| Teal  | `#14B8D2` | Pin ring, lower left                      |
| Silver| `#F8FBFE` | Pin ring, upper right, and "Polo"        |
| Gold  | `#E0A44A` | Four-point compass star                   |

The pin gradient runs silver (upper right) to teal (lower left). "Polo" is a
silver word with a warm edge on the right. The live UI accent is still driven
by `--brand-primary` in `apps/web/src/index.css` and is separate from this mark.

## Regenerating raster derivatives

Icons and the OG card are rasterized from the SVGs via headless Chrome; the
generator scripts live in the branding scratchpad. Mirror the SVGs into
`apps/marketing/public/brand/` for the marketing site (the two apps deploy
independently, so they are copied rather than symlinked).

The in-app lockup and these SVGs share one geometry: `PIN_PATH`, `STAR_PATH`,
and outlined Poppins Bold `POLO_WORD_PATH` in `PoloPreSalesLogo.tsx`. No
font file is required at render time. Favicon and marketing OG card are
separate surfaces and were not regenerated with this mark.
