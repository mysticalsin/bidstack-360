# Account rank value excludes a lost bid

## Evidence

Demo OP-2047 is NOS at 1,900,000 and closed_lost. CI Financial's open bid is OP-2041 at 1,240,000, and the historical book adds the lost Managed SOC (OP-H03, 1,200,000) and the lost retirement (OP-H06, 300,000). Strategic Accounts and Account Ranking summed every opportunity into `totalValue`, so CI read as 6.23m and a lost-only account could outrank a live one. Mantu's lost OP-H10 did the same to its 410,000 won.

## Correction

`rankValueUnits` subtracts closed_lost micros before the figure is shown. The auto leaderboard uses the same stage in its SUM. Won revenue still counts. The opportunity count still includes the lost bid.
