# QA — CSV import wizard, hands-on

Synthetic data only. No customer file. Use a stub-auth admin session. Route: `/settings?tab=data-import`.

CSV:

```csv
Account Name,Employees,Country
Northwind Traders,120,US
```

Save it as `accounts.csv`.

## 390 × 844

1. Set the viewport to 390×844. Reload `/settings?tab=data-import`.
2. Confirm the settings sidebar is collapsed behind "Settings menu" and the Data import card is on screen. Open the menu only to confirm Data import is the active section, then close it.
3. Choose `accounts.csv`.
4. On Map columns, each row shows the header, the sample (`Northwind Traders`, `120`, `US`), the words "Maps to", and a select.
5. For each select, confirm the control is fully inside the viewport (not cut off by the card, not blank, not only reachable by sideways scrolling).
6. Confirm the selected values are Name, Employee count, and Country code.
7. Change Account Name to Domain, then back to Name. The required-field warning stays gone when Name is selected.
8. Preview the row. The preview sentence uses the singular ("1 of 1 row"). Do not need to confirm the import for this pass.
9. Screenshot the map step.

## 1440 × 900

1. Set the viewport to 1440×900. Reload and upload the same file.
2. The map step is the three-column table: CSV column, Sample, Maps to. The stacked phone rows are not shown.
3. The Maps-to selects are fully inside the viewport. Account Name is Name, Employees is Employee count, Country is Country code.
4. Change one select and change it back. The table does not clip the control.
5. Screenshot the map step.

## Cancel and Retry (either width)

These need a running API and worker against the same database. They are covered by the automated tests named in `plan.md`. Hands-on, only if that stack is up:

- Start an import, click Cancel once. The request returns without a multi-minute spinner. The job reaches Cancelled.
- On a failed import that offers Retry, double-click Retry. One import continues. The screen does not show "Migration job is no longer failed".
