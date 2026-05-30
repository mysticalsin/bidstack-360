# OmniParse — optional rich document parsing

BidStack parses uploaded RFP documents (PDF, Word, PowerPoint, Excel, images)
entirely on CPU by default — no GPU, no external service required. When you
want higher-fidelity extraction (tables, multi-column layout, image captions,
model-grade OCR), point the platform at a hosted [OmniParse](https://github.com/adithya-s-k/omniparse)
instance and it will be used automatically.

## How it's wired

The worker's text extractor (`apps/worker/src/lib/extract-text.ts`) is the
single choke point for every document parse (RFP intake, account-intel,
bid-workspace). For any binary document format it:

1. Calls OmniParse **if** `OMNIPARSE_BASE_URL` is set (`POST {base}/parse_document`).
2. **Falls through to the built-in CPU parser** on any failure — unset var,
   unreachable host, timeout, non-JSON body, or an empty result.

This is **fail-open by design**: OmniParse only ever _upgrades_ quality. The
pipeline never depends on it, so there is no GPU requirement and nothing breaks
when OmniParse is down.

| Format       | Built-in (CPU, always available)         | With OmniParse configured             |
| ------------ | ---------------------------------------- | ------------------------------------- |
| PDF          | `pdf-parse` (pdf.js) + optional OCRmyPDF | OmniParse (Surya OCR, layout, tables) |
| DOCX         | `mammoth`                                | OmniParse                             |
| DOC (legacy) | `word-extractor`                         | OmniParse                             |
| PPTX         | `node-pptx-parser`                       | OmniParse                             |
| XLSX         | `@e965/xlsx` → CSV                       | (CPU path)                            |
| Images       | optional Tesseract                       | OmniParse (Florence-2 captions + OCR) |

## Configuration

| Env var                | Default              | Purpose                                                           |
| ---------------------- | -------------------- | ----------------------------------------------------------------- |
| `OMNIPARSE_BASE_URL`   | _(unset → disabled)_ | Base URL of the OmniParse server, e.g. `http://omniparse:8000`    |
| `OMNIPARSE_TIMEOUT_MS` | `60000`              | Per-document call timeout. Kept below the 90s parser-sandbox cap. |

Set these on the **worker** process. Leaving `OMNIPARSE_BASE_URL` unset keeps
everything on the built-in CPU parsers.

## Hosting OmniParse

OmniParse is a Python service that needs Linux and a GPU (~8–10 GB VRAM — a T4
is enough). It can't run on a typical Windows dev box, so host it on a
cloud/GPU node and point `OMNIPARSE_BASE_URL` at it. Rough Docker shape:

```bash
docker run --gpus all -p 8000:8000 savatar101/omniparse:latest
# then, on the worker:  OMNIPARSE_BASE_URL=http://<host>:8000
```

See the upstream repo for current image tags, model downloads, and GPU setup.

## Verifying

With `OMNIPARSE_BASE_URL` set, upload a document and check the worker logs: a
successful OmniParse parse returns its markdown; any error logs and silently
falls back to the CPU parser (the extraction still succeeds). To confirm the
fallback path, point the URL at an unreachable host — extraction should still
complete via the built-in parser.
