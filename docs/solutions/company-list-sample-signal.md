# Companies list names a sample signal

## Problem

Demo accounts such as CI Financial store a watchdog headline that starts with "Sample:". The companies list Signal cell showed only the kind, for example "Results". A summary that still stored `sample: false` and the source label `sample` left that pill looking like a live filing.

## Solution

The Signal cell shows Sample when the row is flagged sample or the title starts with "Sample:". A source label that is the token `sample` is read as "Sample data". A live headline stays unmarked.

## Verification

`apps/web` `IntelCells.test.tsx`.
