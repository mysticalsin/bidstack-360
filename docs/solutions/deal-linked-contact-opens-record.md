# Deal linked contact opens the contact record

**Problem:** On a deal, the linked contact's name was plain text. Opening that person meant leaving the deal and searching Contacts. A name search can match a different person. The role menu had no accessible name, and the primary control was announced as a star character. The remove control hovered with `--rose-9`, which is not a theme token, so the hover color never applied.

**Fix:** Build `/contacts/<uuid>` only when `contact.id` matches a uuid. A name, a script, a path, or a blank stays text. The name is never written into the address. The link, the role menu, and the row actions use a 44px target and a 2px focus ring. Link text uses `--brand-primary` in light (6.53:1 on white) and `--brand-deep` in dark (8.38:1 on the card). The role menu is named "Role for {name}". The primary control's accessible name is "Set as primary" or "Unset primary". Remove uses `--danger`, which is a measured token.

**Why it works:** The contact id is the record. The displayed name is only the label. An unsafe id cannot become a navigation path. Keyboard and touch users can reach the same row actions as a pointer user.

**Validation:** `apps/web` vitest for `ContactsPanel.test.tsx`, `contactRecordHref.test.ts`, `opportunity-contact-caption.test.ts`, and `OpportunityTabs.test.tsx`. eslint on the staged files. The deal page was not opened in a browser; this environment has no API or demo server.
