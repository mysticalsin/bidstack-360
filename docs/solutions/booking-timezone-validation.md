# Booking timezone validation

**Problem:** Public booking availability showed a usable slot, but the booking create endpoint could reject that same slot as unavailable for visitors in IANA timezones such as `America/New_York`.

**Diagnosis:** Availability was meant to operate on wall-clock schedule rules, but the conversion path mixed UTC date setters with local-time intent. The create endpoint also derived the slot day from UTC instead of the visitor/page timezone, so western timezones could drift to the wrong date.

**Fix:** Centralize wall-clock to UTC conversion in `packages/shared/src/calendar/availability.ts`, derive booking day keys with the selected timezone in `apps/api/src/routes/bookings-public.ts`, and add a regression asserting that `2026-06-05 09:00 America/New_York` maps to `2026-06-05T13:00:00.000Z`.

**Why it works:** The availability preview and booking mutation now replay the same timezone-aware date inputs and compare the submitted UTC instant against slots computed from the intended local day.

**Prevention:** Any booking or calendar change must include at least one western IANA timezone regression where the UTC day can differ from the local day.
