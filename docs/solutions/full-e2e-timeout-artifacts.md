# Full E2E timeout artifacts

**Problem:** A full Playwright run appeared to produce many `ERR_CONNECTION_REFUSED` failures in responsive specs.

**Diagnosis:** The shell command timeout killed the Playwright-managed web server near the end of the run. The failure artifacts captured the aftermath of the killed server, not a product regression.

**Fix:** Rerun the full suite with a timeout comfortably above the expected runtime and a fresh `E2E_PORT_OFFSET`. Treat connection-refused traces after a shell timeout as infrastructure fallout until proven otherwise.

**Why it works:** The suite needs time for API boot, web production build, preview startup, and roughly 270 browser checks. A tight shell timeout can interrupt the server while tests are still queued.

**Prevention:** For full local E2E gates, use a command timeout of at least 20 minutes on this machine or split the suite into focused specs when investigating a specific failure.
