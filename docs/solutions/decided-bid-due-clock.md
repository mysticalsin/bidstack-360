# Decided bids do not wear an overdue clock

A won or lost bid keeps its due date, but that date is history. The opportunities
list, the deal board, and the deal header were still counting it ("211d overdue"
or "12d left"). Demo OP-2046 is closed won, due 2026-04-28.

The due chip takes `settled` when the stage is won or lost, including a custom
stage whose `isWon` / `isLost` flag is set. It says Closed, and the accessible
name repeats the date. An open bid past its date still says it is overdue.
