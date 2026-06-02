# E-Signature Step State

## Problem

The public signing flow uses a canvas-backed signature pad on the sign step and
a separate review/submit step. Moving to review unmounts the canvas component,
so submit-time validation cannot rely on the signature pad ref still existing.

## Pattern

- Persist the canonical `signatureDataUrl` during the sign-to-submit transition.
- Treat the submit step as a confirmation of already-captured signing intent, not
  the place where the prior step's canvas is read.
- If a signer goes back and edits the signature, overwrite the stored data URL
  on the next continue action.
- Keep final submit validation loud: if the stored data URL is missing, send the
  signer back to the signing step with a human recovery message.

## Verification

- `pnpm --filter @bidstack/web e2e -- flows/esignature.spec.ts`
- `pnpm --filter @bidstack/web typecheck`
