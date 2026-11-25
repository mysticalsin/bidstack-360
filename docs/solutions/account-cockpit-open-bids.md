# Account cockpit open bids

The account cockpit "Account opportunities" card used to load `limit: 5` with no company filter, then keep rows whose customer name matched. On the demo seed the five newest rows are closed deals for other accounts, so Logistec, MAPFRE, MAHLE and DNB rendered as having no opportunities. CI Financial's open bid is older than its closed book, so a latest-five window on that account hid the open deal too.

The cockpit now asks for that company's bids (search by name when the cockpit key is not a company uuid) and shows the open ones. Decided bids from the same read stay available for win/loss reasons. A failed read says the list did not load.
