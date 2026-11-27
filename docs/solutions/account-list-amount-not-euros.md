# Strategic and ranking amounts are not euros

## Problem

Key Accounts and Top Accounts summed opportunity `valueMicros` and passed the
major-unit total through `formatMoney(..., 'EUR')`. An opportunity does not
store a currency. On the demo book that printed CI Financial's 1,240,000 as
`CA$1.24M` and Rush's 4,800,000 as `CA$4.8M`: a compacted figure in the
workspace display currency, converted as if the source were euros.

## Fix

Those surfaces use `formatUnspecifiedAmount` and the shared basis sentence
`currency not recorded; not a euro forecast`. Open-deal and contact counts
stay counts and do not carry the sentence. The All-accounts list is a
separate change and is not edited here.

## Do not

Do not send a key-account or top-account total through `useFormatMoney` or a
hardcoded `EUR` source. That both invents a currency and FX-converts the book.
