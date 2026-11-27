# A booking day is the guest's calendar day

**Problem:** The seeded discovery page offers 09:00–17:00 every day. Availability built the window as noon UTC through 23:59 UTC. In Paris, 23:59 UTC is already the next morning, so Thursday's page also offered Friday 09:00.

**Fix:** `bookingDayWindow` is local midnight through the instant before the next local midnight. The day walk steps one calendar day, so the 25-hour Toronto fall-back Sunday is not listed twice. A 16:30 Honolulu slot stays, because that instant is the next UTC date and still Thursday in Honolulu.

**Do not:** clip the window at 23:59 UTC. That hides late slots west of UTC.
