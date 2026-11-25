# Sample financial books on an account

Demo seeds store fixture fiscal years with `source: fixture` and a homepage
as `sourceUrl`. The account financials table linked that homepage and called
blank lines "Not disclosed", so the example read as a filing that had been
checked.

## Decision

- A sample year shows Sample in the source column and does not link out.
- A line the sample never included says "Not in sample".
- A real filing still links its source and still says "Not disclosed" for a
  line that filing omitted.

## Verification

`FinancialsPanel.test.tsx` fails while a sample year links its source URL
and while a blank sample line says "Not disclosed".
