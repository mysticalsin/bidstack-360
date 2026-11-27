# Demo fixture bids still raise a deadline alert

Open fixture bids store absolute due dates from 2026-06-30 through 2026-09-30. The bid-deadline scan keeps a row only when that stored date is inside the last 30 days or the next 7. On a later clock every seeded date is older than the lookback, so the scan returns nothing and the owner never sees a 7/3/1 alert.

`projectFixtureBidAlertDue` runs when the mode is exactly `demo`. It slides an open row whose code and due date still match the seed, so the earliest of that set is tomorrow. The gaps stay. The stored row is not changed. Rows the date window would miss, and whose projected date is inside it, are added to the query. Rows the date window would return, and whose projected date is outside it, are left out.

`real`, `Demo`, `DEMO`, `demo-x`, and `notdemo` do not slide. A different code, an edited date, a closed stage, and a won or lost pipeline stage stay on the stored day. A seeded code that does not slide, and whose stored day is outside the scan window, is not alerted. While the seeded dates are still today or later, the shift is zero. An omitted mode treats only exact `POLO_DATA_MODE=real` as real.

The opportunity list, the calendar, and the dashboard close date are a separate clock. This scan does not write the opportunity row.
