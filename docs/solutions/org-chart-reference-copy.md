# Org chart reference copy

## Problem

An account with no saved org chart showed a Sample badge. The coverage line
called the structure a Sample. A placeholder person said "Sample placeholder".
The account card said Sample. A seller was told the chart was still a demo.

## Solution

A chart with `sample: true` is labelled **Reference**. The coverage line and
the account card call unmet names **reference records**. A placeholder person
says **Reference record**.

The chart flag stays `sample: true`. Placeholder people stay `source: 'sample'`.
A saved chart is not labelled Reference and is not labelled live.

## Why it works

A production CRM names a reference record and an empty saved chart. It does
not describe the workspace as a sample, and it does not present the generated
structure as a live org chart.

## Prevention

Customer-facing org-chart copy lives in
`apps/web/src/components/orgchart/reference-copy.ts`. Do not put "Sample",
"demo", "sandbox", "illustrative", or "not live" back on the badge, the
coverage line, the person panel, or the account card.
