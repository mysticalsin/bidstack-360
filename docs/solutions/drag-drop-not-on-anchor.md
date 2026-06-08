# Don't make a `<Link>` (or any anchor) draggable

**Problem:** Pipeline cards used a react-router `<Link to="/opportunities/:id" draggable>`
as the draggable element. Drag-and-drop "worked" until users reported:

1. The drag ghost was a transparent rectangle showing the link's URL — not a
   card snapshot.
2. After a successful drop, the page would sometimes navigate to the dragged
   card's detail view, undoing the user's intent.
3. `dataTransfer.getData('text/plain')` returned the URL (`/opportunities/abc-123`)
   instead of the opportunity id we explicitly `setData`'d, forcing the drop
   handler to do this string-parsing hack:
   ```ts
   if (id.includes('/')) {
     const parts = id.split('/');
     id = parts[parts.length - 1] ?? '';
   }
   ```
4. Custom MIME-type entries (`opportunity-id`) were silently dropped in some
   browsers because anchors are treated as link-drag sources first.

## Root cause

`<a>` elements have **implicit drag behavior**: when `draggable` is true (which
is the default for anchors with `href`), the browser:

- Sets `text/uri-list` and `text/plain` on the dataTransfer to the link's
  resolved URL
- Uses a default drag image showing the URL as a chip
- Fires a synthetic `click` after `dragend` if the pointer didn't move far
  enough — which causes navigation

Custom `setData` calls _can_ layer additional entries on top, but they don't
remove the URL entries, and many browsers prioritize the standard MIME types
when reading on the drop side.

## Fix

Render the draggable as a `<div role="button" tabIndex={0}>` and navigate via
`onClick`:

```tsx
<div
  role="button"
  tabIndex={0}
  draggable
  onClick={() => {
    if (draggedRef.current) {
      // Suppress the click that fires after dragend on the source element.
      draggedRef.current = false;
      return;
    }
    navigate(`/opportunities/${opp.id}`);
  }}
  onDragStart={(e) => {
    e.dataTransfer.setData('text/plain', opp.id);
    e.dataTransfer.setData('application/x-bidstack-opportunity-id', opp.id);
    e.dataTransfer.effectAllowed = 'move';
    draggedRef.current = true;
  }}
  onDragEnd={() => {
    window.setTimeout(() => {
      draggedRef.current = false;
    }, 0);
  }}
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      navigate(`/opportunities/${opp.id}`);
    }
  }}
  aria-roledescription="draggable opportunity"
>
  {/* card content */}
</div>
```

Key elements:

- `role="button"` + `tabIndex={0}` keeps the element keyboard-focusable and
  announces correctly to screen readers (previously the `<Link>` was an
  `"a"` so it was already accessible — `role="button"` preserves that).
- `onClick` handles navigation; the `draggedRef` boolean suppresses the
  synthetic click that fires after `dragend`.
- `onKeyDown` adds explicit Enter/Space handling — anchors got this for
  free, divs don't.
- Custom MIME type (`application/x-bidstack-...`) signals "this is our
  data, not a URL." The dual `text/plain` entry is the standard fallback
  but no longer needs to be a URL.

## Prevention rule

**Anchors are for navigation, not for drag-and-drop sources.** When a
component is both clickable AND draggable, render a `<div role="button">`
or `<button type="button">` with explicit click handling. Use `<Link>` /
`<a>` only when the _primary_ affordance is navigation and the element is
not draggable.

For pipeline cards, also add stable `data-testid`, `data-opportunity-id`, and
`data-stage-id` hooks so E2E can assert both placement and persistence. A test
that only checks "drag did not throw" is insufficient for CRM forecasting: it
must prove the card appears in the target column and the opportunity detail API
returns the new stage.

## Detection

Grep for `Link.*draggable` or any anchor-typed element with `draggable={true}`:

```bash
rg 'Link.*draggable' apps/web/src
rg 'draggable\s*=\s*\{?true' apps/web/src --type tsx
```

## Files affected (BidStack)

- `apps/web/src/pages/PipelinePage.tsx` — converted `PipelineCard` from
  `<Link>` to `<div role="button">` (Phase: dark-purple sprint, fix wave).
- `apps/web/src/pages/pipelineBoard/PipelineCard.tsx` - re-fixed the split card
  component after it regressed to a draggable `Link` (2026-06-06).
- `apps/web/e2e/flows/pipeline.spec.ts` - reversible keyboard-move regression
  checks target-column placement and persisted API state.
