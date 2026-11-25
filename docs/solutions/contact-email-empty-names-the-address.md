# Contact email empty names the address

**Problem:** On a contact, the email panel said "No email yet" whenever no messages were filed. Demo contacts such as Klaus Vogt already have an address (`klaus.vogt.<workspace>@example.com`). The line read as a missing address. The panel stays mounted when the record changes from Klaus Vogt to Lena Fischer, so a mail target taken from the first person would be stale.

**Fix:** When the contact has a plain address and no messages, the panel says nothing is filed and mails that address. The link is the address on the current contact. A scheme, a word, or a blank value stays "No email yet". A company panel with no contact address is unchanged.

**Why it works:** "No messages" is the filed-thread gap. The address is still on the record, and the href is read from that address each render.

**Validation:** `pnpm --filter @bidstack/web exec vitest run src/components/email/EmailPanel.contact-empty.test.tsx src/components/email/EmailPanel.test.tsx`
