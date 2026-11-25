# Sample company news stays on the intel list

## Problem

Demo accounts such as CI Financial store watchdog stories with source `sample` and an empty source URL. The company intel News tab treated every empty URL as an unchecked rumour, so those stories sat behind "Show N items without a source link" and the tab said nothing had a source link.

## Solution

The intel read marks source `sample` the same way it marks `fixture`: `sample: true` and the label "Sample data". The News tab lists a sample row even when it has no URL, with a Sample chip and no link. A real row with no URL stays behind the disclosure.

## Verification

`packages/db` `company-intel-read.test.ts` and `apps/web` `NewsPanel.test.tsx`.
