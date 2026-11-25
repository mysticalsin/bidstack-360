# A decided deal-board card does not count down its due date

Demo seed stores a due date 45 days out on every bid, including Stellantis (closed won) and Spotify (closed lost). The board card counted that date down, and a past date on a decided bid read as overdue.

The card says Closed once the board stage is won or lost, including a stage named Won when the stage flag says so. The date stays in the accessible name. An open bid keeps the countdown. The detail-page chip is a separate change.
