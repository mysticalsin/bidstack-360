# Brand assets

Drop the canonical BidStack 360° lockup artwork here. The React `BidStack360Logo`
component (apps/web/src/components/brand/BidStack360Logo.tsx) auto-detects these
files and renders them via `<img>`. If a file is missing, the component falls
back to the inline SVG mark + wordmark, which is intentionally minimal and is
also what the favicon ships.

| Slot                           | Filename (this directory)      | Used by                                           |
| ------------------------------ | ------------------------------ | ------------------------------------------------- |
| Full lockup, light backgrounds | `bidstack360-logo.png`         | Sidebar, mobile nav header, marketing nav/footer  |
| Full lockup, dark backgrounds  | `bidstack360-logo-inverse.png` | Login page (over starfield)                       |
| Mark only (square), light bgs  | `bidstack360-mark.png`         | Optional — favicon already covered by `/icon.svg` |
| Mark only (square), dark bgs   | `bidstack360-mark-inverse.png` | Optional                                          |

## Spec

- Aspect ratio: roughly **4.5 : 1** for the full lockup (mark on the left,
  wordmark + tagline on the right). The component scales by height; width
  flexes via `w-auto`.
- Mark variant: **1 : 1** square.
- Format: PNG with transparent background. SVG is also accepted — rename the
  file extension and the component will set the right MIME via the `<img>`'s
  natural detection.
- Resolution: ship at **3×** the intended render size (the sidebar renders at
  40 px tall, so 120 px tall for crisp Retina is the floor; 240 px tall is
  better and still tiny in bytes).
- The "by Mantu" attribution should already be baked into the artwork. If it
  isn't, the component injects a separate sub-line — but the cleanest result
  is when the PNG itself carries it.

Mirror the same files into `apps/marketing/public/brand/` for the marketing
site. They're not symlinked because the two apps deploy independently.
