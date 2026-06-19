# Editable Technical Stack With Provider Deltas

## Problem

Account users need to correct a company's technology stack without losing the
provider intelligence that arrives later from enrichment, notes, or registry
syncs. A display-only stack creates two bad outcomes: manual corrections get
overwritten by provider refreshes, or provider changes disappear once the user
starts curating the account.

## Solution

- Persist the curated stack through `CompanyFieldOverride` under the
  `technicalStack` field key. This avoids a migration while keeping the same
  audit path as other cockpit overrides.
- Store both the curated stack and dismissed provider suggestion ids in the
  override value.
- Build one backend `TechnicalStackState`: `manualStack`, `providerStack`,
  `effectiveStack`, `suggestions`, and `updatedAt`.
- Treat provider-only items as deterministic suggestions keyed by
  `category + vendor`. Users can accept them into the curated stack or dismiss
  them without losing the provider source trail.
- In the cockpit, fall back to the visible cockpit stack until a saved override
  exists. A fetched empty API state must not erase visible provider/default data
  unless it carries an explicit saved override marker.
- Invalidate both the technical-stack query and dashboard cockpit query after
  save/accept/dismiss so the visible account page and command-center state stay
  aligned.

## Verification

- Unit-test the stack service for manual precedence, provider suggestions,
  accept provenance, and dismissed-suggestion filtering.
- Route-test persistence through the company API and verify the account cockpit
  returns the curated stack.
- Component-test edit/save, add/remove, accept/dismiss, and the async empty
  state fallback.
- Browser-test against a freshly restarted API/web pair before judging new
  routes; stale dev servers can otherwise mask completed code.
- Run axe on the composed account cockpit after the edit UI is rendered.
