# Public booking waits for the read

## Problem

The public booking page treated every availability failure as a missing link. A network failure and an HTTP 500 both said the scheduling link was invalid or no longer accepting meetings. The schedule had not arrived, so that was not a finding.

## Correction

`publicBookingPhase` reports unread, failed, missing, or ready. A failed read says the booking page could not be loaded. It does not say the link is invalid, and it does not say the day is empty. A link the server closed as missing stays on that sentence. A loaded schedule still shows, including a settled day with no slots. A read still in flight keeps the loading title.

## Verification

`PublicBookingPage.read.test.tsx`. The network failure and the HTTP 500 failed before the phase check.
