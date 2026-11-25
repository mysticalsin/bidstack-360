# All-accounts pipeline is not a euro forecast

## Evidence

Demo OP-2041 is 1,240,000 at 65% probability. The opportunity table has no currency column. The All-accounts header, the weighted-pipeline tile, and each account card passed that weighted micros figure through `formatMoneyMicros(pipelineMicros, 'EUR')`, which also converts into the selected display currency.

## Correction

Those three surfaces print the weighted major-unit number with `accountPipelineAmount`. The basis sentence is "currency not recorded; not a euro forecast". The open-deals tile stays a count. No exchange rate is applied. A won or lost bid stays out of the weighted figure.
