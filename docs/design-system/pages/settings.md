# Settings Page — Design Overrides

**Route:** `/settings`  
**Component:** `SettingsPage.tsx`

## Unique layout
- Two-column: nav rail (200px, left) + content panel (fluid)
- Nav rail: grouped links (Account, Team, Integrations, Notifications, Advanced)
- Each settings section: `Card` with `SectionHeader`, full-width form fields

## Component overrides
- Toggle switches: Radix Switch with `--brand-primary` thumb when active
- Form sections: max-width 600px on content — never full-bleed to avoid long line lengths
- Danger zone section: `--danger-tint` background, `--danger` border-left 4px accent
- Save button: sticky bottom of scroll area on mobile

## Motion
- Section change: `fadeUp` variant, 200ms
- Toggle flip: 180ms ease, spring snap on thumb movement
- Saved confirmation: `SavedFlash` component, 2s auto-dismiss

## Dark mode specifics
- Nav rail active item: `--brand-primary-tint` background, `--brand-primary` left border 2px
- Danger zone: `rgba(251,113,133,0.08)` background, `rgba(251,113,133,0.3)` border
