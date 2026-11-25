# Deal board amounts are not a euro forecast

## Evidence

Demo OP-2041 is 1,240,000 and the deal record says the currency was never
stored. The opportunities list prints that number with "currency not recorded;
not a euro forecast". The deal board passed the same number, the column total,
and the pipeline tiles through `formatMoney(value, 'EUR')`, which also converts
into the selected display currency. Figures at or above 1,000,000 were compacted
into euro millions.

## Correction

Cards, column totals, and the total-pipeline and open-value tiles use
`formatUnspecifiedAmount`. The card and the column total keep the number on
the figure and put the basis in the accessible name. The two money tiles put
that basis on the line under the number, the same way the opportunities KPI
does, so the headline stays one line and the other tiles keep a blank line. No
exchange rate is applied.
