# Cockpit activity follow-up

## Problem

The account cockpit activity row serialized a follow-up as `Task is <status>.` and rendered that subject as plain text. Demo follow-ups due in May 2026 are late on a later day, and the row did not open `/tasks/:id`.

## Solution

`buildActivities` appends `Overdue: Nd late.` when the follow-up is not done and its due day is before today (UTC). Due today, a future date, a missing date, and a done follow-up stay on the status sentence. A `task` row links to `/tasks/:id` with a visible focus ring. Other activity kinds stay text.
