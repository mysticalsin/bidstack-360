# Dashboard command hero layout shift

**Problem:** Dashboard CLS was about 0.20 when the pipeline report arrived late, and about 0.004 when it arrived immediately. The budget is 0.05.

**Diagnosis:** The pending signal cell rendered a 12px bar. The loaded "Closing within 7 days" and "Weighted pipeline" heads wrap to about 46px, so the hero grew from 314px to 336px and the cockpit grid moved down. That one shift was the 0.20 score.

**Fix:** The pending cell uses the same head, value, and progress structure. `.command-signal` reserves 140px and `.command-signal-head` reserves 46px, which is the wrapped height.

**Why it works:** The hero's first paint is already the settled height, so the report arriving does not push the cockpit. The CLS budget stays 0.05.

**Prevention:** `e2e/performance/core-web-vitals.spec.ts` still asserts dashboard CLS ≤ 0.05. A warm cache will not catch this; delay the API when reproducing it.
