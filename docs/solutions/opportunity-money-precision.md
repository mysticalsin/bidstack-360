# Opportunity money precision (E4)

**Problem:** Create/patch/import stored `BigInt(Math.round(value * 1e6))`
and list/detail serialized `Number(valueMicros) / 1e6`. Both convert
through IEEE-754 before the micros quantum, so a deal past
`Number.MAX_SAFE_INTEGER` micros (~$9.007B) silently stored or returned
the wrong amount.

**Fix:** `unitsToMicros` parses a decimal string (or `toFixed(6)` for
number input) with BigInt. `microsToUnits` already splits whole +
remainder. Opportunity write paths and `serializeOpportunity` use those
helpers. Storage is still `valueMicros` BigInt.

**Do not:** multiply or divide micros with `Number` on the opportunity
write/read path. Display formatting stays at the edge.
