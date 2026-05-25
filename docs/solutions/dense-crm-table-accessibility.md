# Dense CRM Table Accessibility

**Problem:** Presales operators scan dense tables and task lists all day. Decorative row animation, small checkbox targets, pointer-only ordering, and fake tab semantics slow keyboard, touch, and assistive-tech users.

**Fix:**

- Keep dense table rows static. Reserve motion for meaningful state changes such as saved-cell feedback, reorder layout, and dialog transitions.
- Wrap bulk-selection checkboxes in `.table-checkbox-hit` so the interaction target is at least 44px without visually bloating the checkbox.
- Use real control semantics: filter chips are `button` controls with `aria-pressed`, not tabs unless arrow-key/roving-tab behavior is implemented.
- Provide keyboard equivalents for pointer reordering. Tasks keep drag reorder, but also expose Move Up/Move Down buttons and a polite live region announcing the new position.
- Tables wider than the viewport need an explicit horizontal scroll wrapper and a stable `min-width`; selected rows need a visible row-level background, not checkbox-only state.
- Destructive actions must be visible, named, and focus-ringed; avoid hover-only delete controls and native `window.confirm`.

**Why it works:** The UI keeps a premium feel while preserving enterprise usability: users can scan quickly, touch targets pass WCAG sizing expectations, keyboard users can complete the same workflows, and screen readers get accurate state changes.

**Validation:**

- `pnpm --filter @bidstack/web typecheck`
- `pnpm --filter @bidstack/web lint`
- `pnpm --filter @bidstack/web test`
- `pnpm --filter @bidstack/web build`
- Browser-smoke `/leads`, `/opportunities`, and `/tasks` against a current preview server, checking page headings, console errors, accessible button names, task filter semantics, keyboard reorder buttons, and status-button labels.
