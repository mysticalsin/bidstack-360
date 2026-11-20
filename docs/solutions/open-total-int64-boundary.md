# Open total int64 boundary and tile CSS

**Problem:** `readOpenBook` treats a sum past signed int64 as too large with
`micros > INT64_MAX_MICROS`. A mutant that changes `>` to `>=` still passed,
because nothing asserted the equal total. The tile test matched the first
`.kn-value` block, comments included, so a comment that contained the wrap
rule hid a later block that still clipped.

**Fix:** `open-book.test.ts` feeds the numeric total
`9223372036854775807` and expects that bigint back, not `micros: null`.
`key-number-tile.test.ts` strips `/* */` comments and checks every rule
whose selector includes `.kn-value`. The value rule must wrap. No block
may set `nowrap`, ellipsis, or `overflow: hidden`.

**Do not:** accept the int64 maximum as too large, or let a CSS comment
satisfy the tile contract.
