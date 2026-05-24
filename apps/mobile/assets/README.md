# Mobile Assets

Place the following files here before running `eas build`:

| File | Size | Notes |
|------|------|-------|
| `icon.png` | 1024×1024 | App icon. No transparency. BidStack brand mark on #0F172A. |
| `adaptive-icon.png` | 1024×1024 | Android adaptive icon foreground layer. Safe zone = 66% (672px). |
| `splash.png` | 1242×2436 | Splash screen. `resizeMode: contain`. Background #0F172A. |
| `favicon.png` | 196×196 | Web favicon (Expo web target). |

## Source assets

The web PWA icons live at `apps/web/public/icons/` (Wave 3 W3-5).
Use the 1024×1024 variant as the base, adjust safe zones for Android adaptive.

## Generating icons

```bash
# Using expo-cli (requires Node 18+)
npx expo-optimize  # squoosh-based compression
```

Or use AppIcon.co / Icon Kitchen for batch generation from a single source SVG.
