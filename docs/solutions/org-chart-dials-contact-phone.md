# Org chart dials the contact phone it shows

**Problem:** A chart node with no phone of its own shows the linked contact's phone. Demo contacts store that number with spaces (`+49 30 1234 5670`). The call link required digits only, so the link was dropped and the person looked like they had no phone.

**Fix:** The call href is `normalizePhone` of the printed number, the same check the chart editor already uses. The label stays the printed phone. A fragment, a short number, or a scheme stays text.

**Why it works:** The digits are the number. The printed form is only the label.

**Validation:** `pnpm --filter @bidstack/web exec vitest run src/components/orgchart/ContactLinks.dial.test.tsx src/components/orgchart/OrgPersonNode.test.tsx`
