# Contact detail waits for the person

## Evidence

`ContactDetailPage` treated `isLoading` as the only unread state. A paused
first read has `isLoading` false and no person, so the page said "Contact
not found" and that the contact may have been deleted. An in-flight read
showed the skeleton and did not say the contact had not arrived.

## Correction

`contactRecordPhase` reports unread, failed, missing, or ready. Unread
(in flight or paused, no person) says "Checking this contact. The contact
has not arrived." and keeps the detail skeleton. A failed read stays on
"Couldn't load contact". A settled success with no person still says
"Contact not found". A person that arrived still shows.

## Verification

`ContactDetailPage.record-read.test.tsx`. The paused and in-flight cases
failed before the phase check.
