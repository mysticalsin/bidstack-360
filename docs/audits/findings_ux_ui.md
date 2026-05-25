# UX/UI & Design System Audit Findings

## Resolved Issues from Previous Audit
- **Mobile Touch Targets:** Core form components (`Input`, `Select`) now correctly implement `pointer-coarse:min-h-[44px]`, adhering to Apple HIG guidelines for mobile touch targets.
- **Interactive States:** Missing hover borders have been added to inputs. `TabsTrigger` and `Button` components now fully implement all interactive states (hover, active scale, disabled opacity).
- **Sub-grid Spacing:** 6px utility classes (`py-1.5`, `gap-1.5`) have been successfully replaced with `py-1` and `gap-1` (4px), aligning core UI with the strict 4px/8px spatial grid.

## Current Findings

| ID | Severity | Location | Finding | Fix Effort |
|---|---|---|---|---|
| 1 | High | `src/styles/cockpit.css`<br>`src/styles/org-dashboard.css` | **Legacy Prototype Typography:** Extracted dashboard CSS still uses fractional and arbitrary font sizes (`10.5px`, `11.5px`, `12.5px`, `13px`) that completely violate the standard Tailwind v4 9-step type scale. | Medium |
| 2 | High | `src/styles/cockpit.css`<br>`src/styles/org-dashboard.css` | **Legacy Prototype Spacing:** These files contain hardcoded, off-grid pixel values for padding and margins (e.g., `14px 18px`, `7px 8px`, `9px 10px 8px`) that break the 8px/4px spatial grid standard. | Medium |
| 3 | Medium | `src/index.css` (Missing)<br>Used in multiple `.tsx` and `.css` files | **Orphaned Token Variables:** Several surface token variables are actively used in class strings (e.g., `hover:bg-[var(--surface-hover)]`) and CSS but are never actually defined in the `index.css` root tokens. Specifically: `--surface-soft`, `--surface-hover`, and `--surface-raised`. | Low |

**Final Domain Score: 7.5 / 10**
