# Display micros stay integers until a safe cross rate

**Problem:** The display hooks rebuilt every micros amount with
`Math.round(amount * 1e6)` before calling `formatMoneyMicros`. That is
the same IEEE-754 step `unitsToMicros` refuses on writes. Past about
$9.007B the rebuilt integer is not the stored one, including when the
currency did not change.

**Fix:** `rateRelation` looks at the currency codes and the rate quotes,
not at the money before and after. Same currency and an identical quote
pass the stored micros string to `formatMoneyMicros` with the display
currency. A cross rate still uses the existing Number conversion, and
only when the rebuilt micros are a safe integer. Otherwise the original
micros are labeled in the source currency. Invalid micros stay an em dash.

**Range:** `formatMoneyMicros` still converts the unit count with
`Number`. It does not render an exact integer once that unit count
exceeds `Number.MAX_SAFE_INTEGER`. Exact decimal text for storage and
non-currency tokens remains `formatMicrosDecimal` in
`packages/shared/src/utils/money.ts`. This display path does not add a
second renderer.

**Do not:** infer a failed conversion because the rounded amount equals
the input. Do not import another currency module to avoid this.
