# PDF Renderer Fallback

## Problem

The API can lazily load a heavyweight browser renderer for faithful HTML to PDF
output, but clean or constrained environments may not install that optional
renderer. Any user workflow that depends on PDF generation must still fail
predictably or complete through a simpler renderer.

## Pattern

- Use the browser renderer when available for high-fidelity HTML output.
- Keep a lightweight `pdf-lib` fallback for critical transactional documents.
- The fallback intentionally extracts text and data URL images instead of
  executing arbitrary HTML. This is safer and good enough for internal signing
  receipts, confirmations, and audit copies.
- Cache both renderer outputs with the same key so repeat downloads remain fast.
- If a workflow requires pixel-perfect HTML, make the browser renderer a startup
  requirement and fail closed before users can enter the workflow.

## Verification

- `pnpm --filter @bidstack/api typecheck`
- `pnpm --filter @bidstack/api lint`
- `pnpm --filter @bidstack/web e2e -- flows/esignature.spec.ts`
