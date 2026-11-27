# Demo fixture deal intel stays on today's clock

`intelFor` stores one payload for every fixture deal. The refresh is 2026-05-10. The buying triggers run from 2026-03-20 to 2026-05-01, including "NIS2 deadline approaching". The news item is 2026-04-22. The seed writes those instants again on update. A restored demo keeps them. The deal page prints the stored days, so the ribbon says the intel was refreshed in May.

`projectFixtureIntel` runs when the public identity mode is exactly `demo`. It slides a refresh, trigger, or news field that still matches the seed, so the refresh day is today. The gaps stay. A different id, an edited instant, and `real` stay on the stored day. While the seeded refresh is still today or later, the shift is zero. Hiring is not moved. Nothing is written back.

The opportunity detail read applies that clock. The list read does not carry this payload.
