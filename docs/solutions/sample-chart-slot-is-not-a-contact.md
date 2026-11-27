# A Sample org-chart slot is a role, not a contact

**Problem:** An account with no saved chart draws a Sample backbone.
Unmet slots were named Alex Morgan, Priya Raman, Samuel Reyes, and so on.
On a demo book those names read as contacts the workspace never had.
Only the CIO slot could be replaced, because its name was already the title.
A met Chief Executive Officer was added beside Alex Morgan.

**Fix:** Every unmet slot is named `Sample <role>`. `mergePeople` fills a
Sample slot when the title matches, then the real name replaces the Sample
label. Saving a Sample chart still stores the role as the name and drops
invented contact details (`fieldsOf` in `client.ts`).

**Where:** `apps/web/src/lib/orgchart/sample.ts`.
