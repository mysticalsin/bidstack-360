# E2E Copy Contracts

**Problem:** A visual refactor changed the dashboard heading from `Dashboard` to `Bid & presales portfolio`, while Playwright still asserted the old heading.

**Diagnosis:** The test encoded stale copy rather than the user-visible intent of the screen.

**Fix:** Update the E2E smoke assertion to match the current page heading and verify a stable KPI label (`Open bids`) so the route still proves the dashboard loaded.

**Why it works:** The assertion now checks the actual dashboard contract after the frontend pivot.

**Prevention:** When renaming a primary route or heading, update the route's smoke test in the same change.
