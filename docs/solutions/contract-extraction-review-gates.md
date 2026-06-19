# Contract Extraction Review Gates

## Context

MSA/rate-card extraction is legal/commercial data. OCR/LLM output can prefill a draft, but it must not silently create contractual terms or attach unverifiable provenance.

## Pattern

- Scope every contract read/write to both org and visible account access.
- When `sourceFileId` is provided, validate the file belongs to the same org and normalized account key.
- When `sourceExtractionId` is provided, validate the extraction belongs to the same org/account, is `done`, and contains a valid `ContractExtractionDraft`.
- Prefer an explicit approval endpoint for extracted drafts:
  `POST /contract-agreements/extractions/:id/approve`.
- Derive `sourceFileId` from the approved extraction so the file/extraction/agreement chain cannot be mixed manually.
- Return review metadata from extraction polling: `reviewStatus`, `approvedAgreementId`, `confidenceBps`, `warnings`, `source`, `sourceFileName`.
- Keep the worker processor directly testable. BullMQ is the production entry,
  but a direct processor seam lets CI prove the exact contract extraction lane
  without Redis timing hiding parser/DB regressions.
- Prove the BullMQ entry separately with an isolated Redis test database. The
  local default is `redis://localhost:6380/15`; override with
  `BIDSTACK_API_E2E_REDIS_URL` / `BIDSTACK_WORKER_E2E_REDIS_URL` when CI
  provides a dedicated Redis endpoint.
- Prove the complete browser path with Playwright-managed services, not an
  in-test child process. Use `E2E_DOCUMENT_WORKER=1` plus a dedicated Redis URL
  such as `E2E_REDIS_URL=redis://localhost:6380/15`, and expose a worker health
  endpoint before the test starts.
- Browser/API/worker approval proof should cover upload-url, local upload,
  finalize, `POST /contract-agreements/extract`, BullMQ worker completion,
  draft apply, extraction approval, saved agreement display, and cleanup.
- Scanned-PDF browser proof should be a separate opt-in gate. Keep normal E2E
  fast and deterministic, then enable OCR explicitly with
  `E2E_DOCUMENT_WORKER_OCR=1` or `BIDSTACK_OCR_ENABLED=true` on a worker runtime
  that has OCRmyPDF/Tesseract.
- When local machines lack native OCR, let Playwright use an external worker via
  `E2E_DOCUMENT_WORKER_EXTERNAL=1`. The external worker must expose the same
  `E2E_DOCUMENT_WORKER_HEALTH_URL`, share the API upload root, and point at the
  same isolated Redis DB as the API.
- If the external worker runs in Docker, bind the focused worker health server to
  `0.0.0.0` with `DOCUMENT_EXTRACT_WORKER_HEALTH_HOST=0.0.0.0`; the local default
  should remain `127.0.0.1`.
- The external OCR browser gate can be run with a Docker worker when Windows
  lacks native OCR. Use the same upload root as the API container/process, the
  same isolated Redis DB, `E2E_DOCUMENT_WORKER_EXTERNAL=1`,
  `E2E_DOCUMENT_WORKER_OCR=1`, `BIDSTACK_OCR_ENABLED=true`, and a health URL
  exposed from the worker container.
- Keep upload finalization resilient under DB IO pressure. The file row and audit
  row should be written atomically with a batch transaction and a pre-generated
  file UUID, not an interactive transaction whose default 5s timeout can expire
  during browser E2E or production load.

## Verification

- API route test should prove:
  - completed extraction approval creates a `ContractAgreement`;
  - polling flips to `reviewStatus: approved`;
  - pending extraction provenance is rejected;
  - source files from another account are rejected.
- Browser regression should prove the account contract card can:
  - open the add-agreement form;
  - drag/drop a source PDF through the real upload-url/local-upload/finalize flow;
  - add and fill a rate-card line;
  - save a manual reviewed agreement;
  - show the saved reference/rate/document link;
  - clean up the created agreement/file rows through the API.
- Browser/API/worker E2E should prove:
  - the focused document worker is healthy before extraction begins;
  - a dropped MSA source file becomes a finalized `File` row;
  - extraction creates a pending row and real BullMQ `document.extract` job;
  - the worker writes a `done` draft visible through extraction polling;
  - the user can apply the draft, approve it, and see the persisted agreement;
  - cleanup deletes the agreement and source file created by the test.
- Scanned-PDF browser E2E should additionally prove:
  - the source PDF has no selectable text before upload;
  - OCR returns enough text for deterministic contract extraction;
  - the browser-approved draft persists the OCR-derived reference, countries,
    rebate, and rate-card line;
  - the gate loud-skips when OCR is not enabled, never silently passing as a
    text-document extraction test.
- Worker integration should prove:
  - a real stored MSA document can be read from the same local-storage root the
    API writes to;
  - the contract lane writes a valid `ContractExtractionDraft`;
  - the contract lane does not create `AccountSolution` / `AccountProduct`
    intelligence artifacts;
  - the same stored-document fixture succeeds through a real BullMQ
    `document.extract` job and focused `document-extract` worker;
  - scanned-PDF fallback is covered by an opt-in OCR runtime gate using an
    image-only PDF fixture and `BIDSTACK_OCR_RUNTIME_TEST=1`;
  - OCR/scanned-PDF behavior is separately gated when OCR runtime dependencies
    are present.
- API queue integration should prove:
  - `POST /contract-agreements/extract` creates a pending extraction row;
  - when `BIDSTACK_ENABLE_QUEUE_IN_TESTS=true`, the route enqueues a real
    BullMQ `document.extract` job;
  - the queued payload carries tenant, account, file, extraction, storage, and
    `extractionKind: contract` fields;
  - the API queue singleton is closed after Redis-enabled tests to avoid open
    handles.
- Consumer tests that import `@bidstack/shared` may need `pnpm --filter @bidstack/shared build` first because runtime imports resolve to `dist`.
- Local developer machines without OCRmyPDF/Tesseract should not fake OCR
  coverage. The scanned-PDF parser test must loud-skip unless
  `BIDSTACK_OCR_RUNTIME_TEST=1`; OCR-capable CI or worker-image checks should
  enable it and set `BIDSTACK_OCR_ENABLED=true`.
- A production worker image should prove the native stack before release:
  `ocrmypdf --version`, `tesseract --version`, `gs --version`, and
  `qpdf --version`, followed by extracting the scanned fixture through
  `extractTextFromBuffer`.
- The root `Dockerfile --target worker` image should pass the same artifact
  probe as any standalone worker Dockerfile: non-root user, expected working
  directory, `eng` and `osd` in `tesseract --list-langs`, OCRmyPDF/qpdf
  versions, and image-only scanned-fixture extraction.
- Root API and MCP image probes should at minimum build the exact target and run
  `id`, `node --version`, and `pwd` inside the image to prove non-root startup
  posture survived Dockerfile changes.
- Alpine worker images need both `tesseract-ocr-data-eng` and
  `tesseract-ocr-data-osd`. OCRmyPDF may call Tesseract orientation detection;
  missing `osd.traineddata` can fail scanned-PDF extraction before parsing.
- Do not trust a Docker image tag just because a previous `docker build` command
  reached the timeout boundary or an image with that tag exists. Probe the
  artifact itself with `tesseract --list-langs` and require both `eng` and `osd`
  before calling the worker image OCR-ready.
- Keep Docker build contexts small enough that a deploy cannot time out before
  code even builds. Generated Prisma client output, stale `.old` query engines,
  local tool caches, screenshots, coverage, and test artifacts should stay out
  of Docker context; the worker image regenerates `packages/db/generated` during
  `pnpm db:generate`.
- Do not mount current source `dist` into an older worker image as a substitute
  for a real rebuilt image. Package export metadata and pnpm symlink topology can
  drift, creating false failures unrelated to OCR. Rebuild the worker image or
  use the local source worker with native OCR installed.
- For a multi-target root Dockerfile, keep worker-only deploys on a worker-only
  builder stage. A worker image should not need to build web/API/MCP artifacts
  just to ship the document worker.
- Keep service runtime images from doing a second workspace prune/install when
  the compiled worker depends on hoisted pnpm workspace topology. For the worker
  image, ship the builder's resolved workspace and probe the final artifact.
- Avoid `chown -R /app` in Docker runtime stages that contain `node_modules` or
  generated Prisma engines. Create the runtime user before artifact copies and
  use `COPY --chown` for built outputs; otherwise image export can spend many
  minutes rewriting ownership into a huge extra layer.
- For root deploy targets, probe API, worker, and MCP images after Dockerfile
  ownership changes. A target can build independently but still fail at runtime
  if `USER bidstack` is set before the user exists.
- If `docker build` or `docker run` times out in this Windows desktop setup,
  check for orphaned `docker` / `docker-buildx` client processes and stop only
  those clients before retrying. Do not restart Docker Desktop casually because
  Tony may have unrelated long-running containers.

## Files

- `apps/api/src/routes/contract-agreements.ts`
- `apps/api/src/routes/files.ts`
- `apps/api/src/routes/contract-agreements.integration.test.ts`
- `packages/shared/src/schemas/contract-agreement.ts`
- `apps/web/src/components/account-intel/ContractAgreementsCard.tsx`
- `apps/web/e2e/serum-account-experience.spec.ts`
- `apps/web/e2e/fixtures/scanned-msa-e2e.pdf`
- `apps/web/playwright.config.ts`
- `apps/worker/src/lib/extract-text.test.ts`
- `apps/worker/src/lib/__fixtures__/ocr-smoke-scanned.pdf`
- `apps/worker/src/queues/document-extract.ts`
- `apps/worker/src/queues/document-extract.contract.test.ts`
