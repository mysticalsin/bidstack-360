# Deal board card names its owner

## Problem

Demo bids store an owner email. The deal-board card showed the company, the amount, and the title, and never who holds the bid. The card link sets an aria-label, which replaces the card text for a screen reader.

## Pattern

Print "Owned by {email}" from the email already on the bid. A missing or blank email says "No owner". Do not derive a person name from the mailbox. Put the same sentence on the accessible name.
