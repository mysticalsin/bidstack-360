# Company intel Sample mark follows the open tab

## Problem

Demo accounts such as CI Financial store sample job posts and no filed years. The company intel heading showed Sample when any of direction, hiring, financials, or news was sample. The filings tab then said "No filed figures" under a Sample chip, so an empty tab looked like demo data.

## Solution

The Sample chip uses only the open tab. A sample hiring fixture still marks the Hiring tab. An empty or live filings tab stays unmarked. Switching back to filings drops the chip.

## Verification

`apps/web` `AccountDirectionSection.test.tsx`.
