# Cockpit risk load does not call an empty file manageable

**Problem:** Demo accounts often have no risk rows. The command center Open risk load signal still said "0 open" and "manageable with owner follow-up", on a full jade bar. That reads as a clean load. An empty file is not a managed one.

**Fix:** No rows says the load is not recorded, in gray, with an empty bar. A high or critical row still says to escalate. A file whose rows are all mitigated still says it is manageable.

**Why it works:** The sentence follows whether any risk row exists, then whether any of those rows are high or still open. An empty file and a closed file are different facts.

**Validation:** `apps/web` vitest `src/components/cockpit/CommandCenter.risk-load.test.tsx`.
