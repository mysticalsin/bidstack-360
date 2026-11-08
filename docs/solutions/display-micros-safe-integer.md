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

**Range:** `formatMoneyMicros` passes Intl an exact decimal string built
from BigInt whole units and a 6-digit remainder, not a Number. Whole units
and cent rounding stay exact at any size, including the int8 column
ceiling `9223372036854775807` micros where `Number(whole) + remainder/1e6`
rounded `...774999` up to `.78`. Compact notation still rounds by design.
Engines without Intl decimal-string support coerce the string to a Number,
which is the old output. Exact decimal text for storage and non-currency
tokens remains `formatMicrosDecimal` in `packages/shared/src/utils/money.ts`.

**Do not:** infer a failed conversion because the rounded amount equals
the input. Do not import another currency module to avoid this.
