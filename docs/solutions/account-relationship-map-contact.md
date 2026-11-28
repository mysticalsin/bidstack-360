# Account relationship map opens the contact

## Evidence

On an account cockpit the relationship map draws the people filed on that company. Demo CI Financial includes Michael Johnson. The name was SVG text, so opening him meant leaving the account and searching Contacts. A name search can match a different person. While the people read was still in flight, the same card said "No contacts yet" and offered to add a contact.

## Correction

A node links to `/contacts/<uuid>` only when the person id is a uuid. A name, a script, a path, or a blank stays text. The account root stays text. The name is underlined. The node is 176 by 52, and the link takes a 2px focus outline.

A people read with no data yet says it is loading. A failed read with no data says it failed and can be retried. A map that already loaded stays up if a later refresh fails. "No contacts yet" is only the settled empty read. The add link is underlined because it sits in a sentence.

## Verification

`relationship-person-href.test.ts`, `AccountVisuals.relationship.test.tsx`, `org-layout.test.ts`, and the account-value contract.
