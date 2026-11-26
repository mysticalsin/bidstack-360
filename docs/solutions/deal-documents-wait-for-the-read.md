# Deal documents wait for the file list

**Problem:** The documents tab on a bid treated a missing file list as an empty bid. The prop defaulted to `[]`, so an unread list and a failed read both said "No documents attached".

**Diagnosis:** The files travel on the opportunity payload. Until that list is present, the tab has nothing to count. An empty array is a settled result. A failure flag means the read did not produce a list, even if a caller also passes `[]`.

**Fix:** `dealDocumentPhase` in `apps/web/src/components/opportunity/deal-document-read.ts` reports unread, failed, or ready. `DocumentsPanel` in `OpportunityTabs.tsx` says "Checking documents. The file list has not arrived." while unread, and "Couldn't load documents" when the read failed. A settled empty list still says "No documents attached". A file that arrived, including one of 61520 bytes, still shows.

**Why it works:** The empty copy is reserved for a list that has arrived with no rows. Unread and failed no longer share that sentence.

**Prevention:** `deal-document-read.test.tsx` fails if a missing list or a failed read says the bid has no files, says "0 files", or says none.
