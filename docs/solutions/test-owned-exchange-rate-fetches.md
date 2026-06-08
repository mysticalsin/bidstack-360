# Test-owned exchange-rate fetches

## Problem

Page/component tests that mock their business data hooks can still trigger a
real fetch through `useFormatMoney()` or `useDisplayMoney()`. Those hooks call
the currency store's `fetchRates()` on mount. In happy-dom, a pending real fetch
is aborted during teardown and prints `DOMException [AbortError]` after the test
suite passes.

## Fix

Tests that render money-formatting hooks must own the exchange-rate dependency:

```ts
const neutralRates = {
  BRL: 1,
  COP: 1,
  CLP: 1,
  USD: 1,
  CAD: 1,
  GBP: 1,
  AUD: 1,
  CHF: 1,
  JPY: 1,
  SEK: 1,
  NOK: 1,
  DKK: 1,
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      headers: new Headers(),
      json: async () => ({
        base: 'EUR',
        date: '2026-06-06',
        rates: neutralRates,
      }),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});
```

Use neutral `1` rates when the test is not asserting conversion math. Use
realistic rates only in currency-specific tests, and assert the changed
formatted values explicitly.

## Prevention

When a test renders a page or component that imports `useFormatMoney` or
`useDisplayMoney`, grep the rendered tree for those hooks and add either:

- a settled fetch stub for `/api/v1/exchange-rates`, or
- valid cached rates in localStorage before the currency store is imported.

Do not leave native happy-dom fetches running in page tests.

## Files affected

- `apps/web/src/pages/TerritoriesPage.test.tsx`
- `apps/web/src/pages/OpportunitiesPage.test.tsx`
