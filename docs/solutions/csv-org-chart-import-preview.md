# CSV org chart import preview

## Problem

A CSV dry run on the org chart returned only how many people would be added. The people table stays hidden unless the response includes `preview`, so the tray was empty. HTML import already listed each person.

## Solution

Build the same preview rows for a CSV plan as for HTML, and return them on the import result. A blank manager cell on someone already on the chart keeps their current manager in that list.

## Verification

`peopleImportPreview` names the manager for a new row and keeps the current parent on an update. The org chart page test requires the CSV tray to show Nora Lee and Omar Haddad before anything is written.
