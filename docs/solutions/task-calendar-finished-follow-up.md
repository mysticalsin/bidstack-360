# A finished follow-up is not a calendar deadline

**Problem:** Demo seed files the Stellantis handover as done on Monday of the week that contains 25 Nov 2026. The task calendar painted that row in jade, so the week looked like it still had work. A month whose only dated follow-ups were finished looked the same as a month with nothing to explain.

**Fix:** Done rows stay off the grid. Open, in-progress, and blocked rows stay on the day the calendar already used. When the visible month has finished follow-ups and no open chip, the calendar says finished follow-ups stay off it.

**Do not:** drop a blocked or in-progress follow-up, or hide the sentence when the month would otherwise look empty.
