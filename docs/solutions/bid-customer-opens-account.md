# A bid opens the account it is filed on

## Evidence

The opportunities list and the deal header printed the customer as text. Demo
OP-2041 is CI Financial, and that company id is already stored on the bid.
The list query did not return it, so the name could not open `/accounts/:id`.
A name search is a second page and can miss the account.

## Correction

The opportunity read shape includes `companyId`. Create and patch still omit
it; the server re-links from the customer name. The list and the deal header
link to `/accounts/:id` when the id is present, and stay plain text when it
is null.
