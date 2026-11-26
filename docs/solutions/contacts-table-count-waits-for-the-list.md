# Contacts table count waits for the list

## Problem

The contacts table live region said "Showing 0 contacts" while the list was still loading, and again when the read failed. A failed read showed "Could not load contacts" and did not say the contacts had not arrived. Zero is the buying group only after a payload settles empty.

## Decision

The live region says "Checking contacts. They have not arrived." while the skeleton is up. A failed read keeps "Could not load contacts" and adds "The contacts have not arrived." A settled empty payload still says "Showing 0 contacts" and "Nobody in the buying group yet." A settled row still names that person.

## Files

- `apps/web/src/pages/contacts/ContactTable.tsx`
- `apps/web/src/pages/contacts/ContactTable.read.test.tsx`
