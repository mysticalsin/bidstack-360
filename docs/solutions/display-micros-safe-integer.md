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
cent rounding are exact at any size. The int8 column ceiling
`9223372036854775807` micros renders `.78`. Its below-half neighbour
`9223372036854774999` renders `.77`, where `Number(whole) + remainder/1e6`
gave `.78`. Compact notation still rounds by design.

Exact digits need exact input: string or bigint micros, or a safe integer
Number. A Number above `Number.MAX_SAFE_INTEGER` micros may already be a
rounded integer (`-9223372036854775000` is stored as `...774784`; some
such integers are exact, but nothing shows which). Both
`formatMoneyMicros` and the display hooks return an em dash for it in
every notation and on every conversion route, before converting it to
BigInt or a string. Compact output is refused too, because a lost digit can
move a rounding boundary: `9149999999999999999` as a Number reads `€9.2T`
where the intended amount reads `€9.1T`.

An Intl without decimal-string support (before Intl.NumberFormat v3) does
not throw: it coerces the string to a Number and loses digits silently,
and the result can differ from both the exact value and the parent
formatter. The formatter therefore probes this once per module load, in
`en-US` with plain decimal options. Without the capability it rounds with
BigInt to two fraction digits and passes Intl a Number that already holds
those digits, when the rounded scaled integer (cents, trailing zeros
included) has at most 15 digits. That covers every int8 amount and is
conservative: `10000000000000000000` micros is exact but returns an em
dash. Compact requests get that exact full amount. This path is tested by
simulating string coercion in Node, not in an old browser. The probe does
not test every locale or notation, and a missing Intl still throws in the
direct formatter (the hooks return an em dash). The files inspected for a
browser target (`apps/web/vite.config.ts` build target `es2022`, the web
`tsconfig.json` libs, the root `package.json` Node engine and its
`browserslist` dependency override) do not state an Intl capability.

Callers that hold micros as Numbers (territory and forecast totals,
`OwnerDrilldown`, `positioning-format`) show an em dash above about
€9.007B. Keeping those visible needs string or bigint micros on the wire.

**Known limit (unchanged policy):** standard notation allows two fraction
digits for every currency, so fractional JPY or CLP micros show decimals,
and a three-decimal currency would be cut to two. A tiny negative that
rounds to zero shows `-€0.00`.

Exact decimal text for storage and non-currency tokens remains
`formatMicrosDecimal` in `packages/shared/src/utils/money.ts`.

**Do not:** infer a failed conversion because the rounded amount equals
the input. Do not import another currency module to avoid this.
