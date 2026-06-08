# Agent Studio Bid Workspace Evidence Handoff

## Problem

Agent Studio had crew execution and the CRM already had bid-workspace OCR and
extraction data, but the crew runner still depended on pasted RFP text. That
breaks traceability: agents can draft from text, but the CRM cannot reliably
prove which document, requirement, or source chunk drove an answer.

## Solution

Use the existing bid workspace as the source of truth for Agent Studio crew
inputs:

1. Search live opportunities from the crew runner.
2. Load `GET /api/v1/bid-workspaces/:opportunityId` for the selected
   opportunity.
3. Show document and requirement counts before users commit the evidence.
4. Build a bounded evidence bundle with:
   - opportunity ID
   - document IDs
   - requirement IDs
   - source chunk IDs
   - priority, mandatory flag, status, and confidence
   - explicit instructions to cite evidence and flag blockers
5. Send `opportunityId`, `documentIds`, `requirementIds`, and
   `evidenceSource=bid_workspace` with the crew input.

## Guardrails

- Bound the payload: max 10 documents, max 30 requirements, max 600 characters
  per requirement, max 18,000 characters overall.
- Preserve section line breaks in the evidence bundle so agents can parse it.
- Treat source material as evidence, not prompt instructions.
- Keep the upload/OCR path in Intake/RFP pipeline; do not create a parallel
  Agent Studio upload system until the end-to-end extraction contract is
  hardened.

## Verification

- `pnpm --filter @bidstack/web exec vitest run src/pages/agentStudio/evidence.test.ts --reporter=dot`
- `pnpm --filter @bidstack/web exec eslint src/pages/AgentStudioPage.tsx src/pages/agentStudio/evidence.ts src/pages/agentStudio/evidence.test.ts --quiet`
- `pnpm --filter @bidstack/web typecheck`
- `pnpm --filter @bidstack/web build`
- Browser smoke on `/agent-studio`: open crew runner, search an opportunity,
  select a workspace, load evidence, confirm `Run crew` enables and line breaks
  remain in the textarea.

## Next Hardening

Add an E2E that proves the full RFP chain:

`upload/import -> OCR/Omniparse extraction -> source chunks -> requirements ->
Agent Studio evidence handoff -> crew run -> cited output -> approval gate`.
