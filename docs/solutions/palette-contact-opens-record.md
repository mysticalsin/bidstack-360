# A palette contact opens its record

## Evidence

The command palette sent a contact hit to `/contacts?search=<name>`. The contacts list keeps search in component state and does not read `search` from the URL. Choosing Michael Johnson, a synthetic CI Financial contact, left the palette on the unfiltered contact list. Global search already addresses `/contacts/<id>`.

## Correction

A local contact hit opens `/contacts/<id>`. The name is not part of the address. The palette row keeps a 44px target and a 2px focus ring.

## Verification

`contact-record-path.test.ts` and `CommandPalette.contact.test.tsx` render the demo contact and assert the address is the record, not a search.
