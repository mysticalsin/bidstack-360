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
- In production containers, install system Chromium and set
  `PUPPETEER_EXECUTABLE_PATH`; do not depend on a Puppeteer browser download
  during package install.
- Resolve explicit `PUPPETEER_EXECUTABLE_PATH`/`CHROME_BIN` before probing
  common system paths. Return explicit paths even if local probing cannot see
  them, so bad production config fails loudly in Puppeteer instead of silently
  choosing a different binary.
- If a workflow requires pixel-perfect HTML, make the browser renderer a startup
  requirement and fail closed before users can enter the workflow.

## Verification

- `pnpm --filter @bidstack/api typecheck`
- `pnpm --filter @bidstack/api lint`
- `pnpm --filter @bidstack/api exec vitest run src/services/documents/document.service.test.ts`
- `docker build --target api --build-arg BIDSTACK_WEB_BUILD_MODE=stub -t <image> .`
- `docker run --rm --entrypoint sh <image> -lc 'test -x "$PUPPETEER_EXECUTABLE_PATH"; "$PUPPETEER_EXECUTABLE_PATH" --version'`
- `pnpm --filter @bidstack/web e2e -- flows/esignature.spec.ts`
