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
from BigInt whole units and a 6-digit remainder, not a Number. On an Intl
that formats decimal strings exactly, whole units and half-away-from-zero
cent rounding are exact at any size, including the int8 column ceiling
`9223372036854775807` micros where `Number(whole) + remainder/1e6` rounded
`...774999` up to `.78`. Compact notation still rounds by design.

Exact digits need exact input: string or bigint micros. A Number above
`Number.MAX_SAFE_INTEGER` micros already holds a different integer
(`-9223372036854775000` is stored as `...774784`), so it renders only in
compact notation and returns an em dash otherwise.

An Intl without decimal-string support (before Intl.NumberFormat v3) does
not throw: it coerces the string to a Number and loses digits silently,
and the result can differ from both the exact value and the parent
formatter. The formatter therefore probes this once. Without the
capability it rounds with BigInt to two fraction digits and passes Intl a
Number that already holds those digits, when at most 15 significant digits
are needed (every int8 amount). Compact requests get that exact full
amount. Anything larger returns an em dash. This path is tested by
simulating string coercion in Node, not in an old browser. The supported
browser range is not defined anywhere in the repo.

**Known limit (unchanged policy):** standard notation allows two fraction
digits for every currency, so fractional JPY or CLP micros show decimals,
and a three-decimal currency would be cut to two. A tiny negative that
rounds to zero shows `-€0.00`.

Exact decimal text for storage and non-currency tokens remains
`formatMicrosDecimal` in `packages/shared/src/utils/money.ts`.

**Do not:** infer a failed conversion because the rounded amount equals
the input. Do not import another currency module to avoid this.
