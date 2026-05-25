# Frontend State Management & Architecture Audit

## 1. Zustand Usage
Zustand is used appropriately for purely global, ephemeral UI state such as user preferences (`preferences.ts`), recent searches (`recentSearches.ts`), layout toggles (`ui.ts`), and task ordering (`taskOrder.ts`). These stores correctly persist to `localStorage` and act as standalone slices of state decoupled from React components.
**Issue:** `stores/currency.ts` bypasses React Query to fetch exchange rates using a raw `fetch` call and manually manages loading, error, and caching logic. This should be migrated to a React Query hook to leverage the existing caching infrastructure and simplify the store.

## 2. React Query Caching
The application configures a global `QueryClient` (`main.tsx`) with highly optimized defaults:
- `staleTime: 120_000` (2 minutes)
- `gcTime: 600_000` (10 minutes)
- Built-in retry logic (retries 5xx, fails fast on 4xx)
- Integrated `hydrateCache` and `persistCache` to persist the cache to local storage.
This results in instant subsequent loads and excellent offline/optimistic capabilities.

## 3. Bundle Size Optimization
The application employs strong bundle size optimization strategies:
- **No Heavy Date/Math Libraries**: Avoids `moment`, `date-fns`, and `lodash`. All formatting is expertly handled by native browser `Intl.NumberFormat`, `Intl.RelativeTimeFormat`, and `Intl.ListFormat` APIs (`lib/format.ts`).
- **Route-Level Code Splitting**: All pages are dynamically imported using `React.lazy` and wrapped in `<Suspense>` within `App.tsx`.

## 4. Component Decoupling & Re-renders
While many components are well decoupled, there are severe memoization defeats in major views that cause excessive re-rendering:
- **`PipelinePage.tsx` (Kanban Board)**: Both `StageColumn` and `PipelineCard` are wrapped in `React.memo`. However, the parent `PipelinePage` passes inline functions (`onDragOver`, `onDrop`, `onCardFocus`, `onCardBlur`) and non-memoized handlers (`handleKey`) down the tree. Because these function references change on every render, the memoization is entirely defeated. Any state change (e.g., hovering over a column or focusing a card via keyboard) causes all columns and all cards in the pipeline to re-render.
- **`ContactsPage.tsx`**: Maps over rows using inline functions (e.g., `onChange={() => toggleOne(c.id)}`) and passes them to `SpotlightTableRow`, which is not memoized. Any update to page-level state like `cursorIdx` or `selectedIds` causes the entire table of contacts to re-render.

## Final Score: 8.5/10
The architecture is solid and highly performant on load, but requires immediate attention to `useCallback` and `memo` boundaries in complex list/grid views to prevent input lag during heavy interaction.
