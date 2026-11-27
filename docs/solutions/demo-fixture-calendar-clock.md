# Demo fixture meetings stay on the calendar

The fixture seed writes five timed meetings on 2026-05-11 through 2026-05-15. The calendar week and the 14-day agenda read `start_at`. On a later clock that week is empty, so the agenda says there are no events.

`projectFixtureCalendarRow` runs when the mode is exactly `demo`, or unset. It slides a row whose client request id and both instants still match the seed, so the earliest meeting lands on today's UTC date at the same time of day. The gaps stay. The stored row is not changed. The list query also loads those seeded instants, because a range filter on the stored week would drop them before the slide.

`real`, `Demo`, `DEMO`, `demo-x`, and `notdemo` do not slide. A different id, an edited start, and an edited end stay on the stored instants. While the seeded week is still today or later, the shift is zero.

The public booking page keeps reading stored `start_at`, so these May rows do not block a current slot. A re-seed puts the anchor times back.
