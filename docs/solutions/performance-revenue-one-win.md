# Performance revenue books a closed win once

## Problem

Demo OP-0005 (Stellantis, 620,000) closes on 25 Nov 2026. The due date is 45 days later, in Q1 2027. Performance, Revenue drew that win in Q4 from the bid's close date and again in Q1 from the projection's won amount.

## Change

Won bars follow the close date on the bid rows. The projection still supplies weighted and open pipeline. Its won amount is not copied once a closed win is already in the rows. If the rows have no closed win, the projection's won amount stays.

## Not this change

The projection query's won quarter is a separate draft. This chart does not change that query, the forecast page, or the win-rate tab.
