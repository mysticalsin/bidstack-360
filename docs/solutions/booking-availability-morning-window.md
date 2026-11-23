# Booking availability morning window

**Problem:** The public booking page listed a morning slot that create then rejected as no longer available.

**Diagnosis:** The day anchor is noon UTC so timezone conversion does not slip to the previous date. `computeSlots` still starts at local midnight. The blocker query used the anchor as its start, so bookings before noon UTC were invisible to availability.

**Fix:** Pad the blocker lookup 14 hours on either side of the anchor, plus the page buffer, and use that same window when create recomputes slots.

**Why it works:** A confirmed 09:00 booking now overlaps the lookup, so it is removed from the slot list before the visitor can submit it.

**Prevention:** Any new booking-day query must use `blockingLookupBounds`, and the public E2E flow must reload after submit and assert the booked slot is gone.
