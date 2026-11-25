# Lead rot settings keeps the day count that was typed

New is 7 when the org has no override. The settings field parsed a cleared
threshold as 0 and clamped 400 to 365, then saved that count. 8.9 was floored
to 8. A non-numeric value was ignored with no reason.

`leadRotDaysDraft` accepts a whole number from 0 to 365. An empty field and
any other value are not saved. The row says why. A typed 0 is still 0.

The pipeline stage editor is unchanged. The lead kanban is unchanged.
