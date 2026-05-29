# NavLink function-className + Radix Slot → stringified into class attribute

**Problem:** A NavLink wrapped in a Radix primitive that uses `asChild`
(Tooltip.Trigger, Dialog.Trigger, etc.) and given the documented React
Router v6 callback className pattern produces a corrupted DOM:

```tsx
<RadixTooltip.Trigger asChild>
  <NavLink to="/dashboard" className={({ isActive }) => cn('sb-item', isActive && 'active')}>
    ...
  </NavLink>
</RadixTooltip.Trigger>
```

renders as:

```html
<a
  class='({ isActive }) =&gt; cn("sb-item", isActive &amp;&amp; "active") active'
  href="/dashboard"
></a>
```

The function's `.toString()` source code ends up inside the `class`
attribute, which means:

- CSS selectors targeting `.sb-item` match **zero** elements
- All styling intended for that class silently fails
- The bug is invisible in tests that mount NavLink without the Radix
  wrapper

This is exactly what bit BidStack's sidebar: collapsed-mode label hiding
(`.sidebar.is-collapsed .sb-item > span { max-width: 0 }`) never fired
because `.sb-item` matched nothing. Visually the sidebar still "looked
like" it expanded/collapsed (the rail width changed) but the labels never
hid.

**Root cause:** Radix's `asChild` is implemented with `@radix-ui/react-slot`.
Slot merges its own props onto its single child, including `className`.
Its className merge is (paraphrased):

```ts
className: [slotProps.className, childProps.className].filter(Boolean).join(' ');
```

`.join(' ')` calls `String()` on every member. When `childProps.className`
is a **function** (which is the canonical NavLink v6 active-state
pattern), `String(fn)` returns the function's source code — and that's
what gets passed back to NavLink as a string className.

NavLink then renders that string verbatim into the `class` attribute.

**Fix:** pass NavLink a **string** className, not a function. NavLink v6
already handles the active state automatically when className is a
string — it appends `"active"` (and `"pending"`, `"transitioning"`) on
its own:

```tsx
// React Router v6 internal logic (simplified):
className =
  typeof props.className === 'function'
    ? props.className({ isActive, isPending, isTransitioning })
    : [props.className, isActive && 'active', isPending && 'pending'].filter(Boolean).join(' ');
```

So the fix is a one-liner:

```diff
- className={({ isActive }) => cn('sb-item', isActive && 'active')}
+ className="sb-item"
```

NavLink will still output `class="sb-item active"` when the route
matches. The DOM is correct, the CSS selectors hit, and the Slot
merging is happy because it received a string.

**Where this hits:** anywhere a NavLink (or other React Router
component that supports function-className like `Link` via custom
wrappers) is placed inside an `asChild`-using Radix primitive — most
commonly `<Tooltip>`, `<Popover>`, `<HoverCard>`, `<Dialog.Trigger>`,
`<DropdownMenu.Item>`.

**Detection:** when sidebar-style CSS that depends on a class hook
"silently doesn't work," inspect the rendered DOM directly — don't
trust source code. The bug looks like a working component until you
look at the actual `class` attribute.

**Prevention rule for the repo:**

- Treat NavLink's function-className as **not safe** for components
  that may be wrapped in `asChild` Radix primitives.
- Default to string className on NavLink. Only use the function form
  when you genuinely need `isPending` / `isTransitioning` AND you
  control all parents (no Slot/asChild anywhere upstream).
- If you must compute extra classes per active state inside a
  Slot-wrapped NavLink, lift the computation: use `useMatch` +
  `useResolvedPath` at the parent and pass the resulting string.

**Files affected (BidStack):**

- `apps/web/src/components/layout/Sidebar.tsx` — both `SidebarItem`
  and `AccountShortcut` wrap NavLink in `<Tooltip>` when the sidebar
  is collapsed.

**Related Radix issue:**
[radix-ui/primitives — Slot merges className via join, breaking
function-typed className](https://github.com/radix-ui/primitives/issues)
(filed as a known sharp edge; unlikely to change because Slot can't
_invoke_ a function-className without knowing the active-state shape
the child component expects).
