# Cockpit open pipeline link

The account cockpit "Open pipeline" link searched the whole book by account name. A shared word matched other customers, and a customer string that was not the account name missed the bids on the card. The list API already filters by company id.

A company uuid now opens `/opportunities?companyId=`. The list asks for that company, the strip above it is this page, and an empty account says so. A name-keyed cockpit still searches by account name, because the list rejects a non-uuid company id.
