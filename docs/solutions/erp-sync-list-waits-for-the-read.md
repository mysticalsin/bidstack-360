# ERP sync list waits for the read

## Evidence

`OdooPlugin.sync` treated a tool result that was not a record list as zero
created and no error. An object and an undefined result used the same shape as
a settled empty array. The pull looked empty and healthy. The list had not
arrived.

## Correction

A result that is not an array is an error: "The ERP record list has not
arrived." Created stays 0 for that model. An empty array stays a quiet zero. A
list that arrived still counts.

## Verification

`odoo.sync-unread.test.ts`. The object and undefined cases failed before the
array check.
