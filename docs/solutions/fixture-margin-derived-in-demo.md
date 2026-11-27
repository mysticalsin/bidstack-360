# Fixture margin is derived, and the example stays in demo

A fixture year stores revenue and operating income and no `_derived`. The key-number tile only read `derived.operatingMargin`, so DNB's synthetic filing showed no margin. The built-in example periods were also returned for every tracked account with no filings, including real mode.

`resolvePeriodDerived` keeps a stored margin. Otherwise it divides income by revenue. Missing, zero, or non-finite revenue stays null. `builtInFinancialSample` is true only in demo, for an eligible account, with no stored filings. `marginPeriodsForMode` drops fixture and example years in real mode. The financials section hides a sample payload unless identity says demo.

A stored 16.5 still wins. Demo still labels the example Sample. A settled empty general account stays empty.
