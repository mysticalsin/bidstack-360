# OmniParse - optional rich document parsing

BidStack parses uploaded RFP documents on CPU by default: PDFs, Word,
PowerPoint, Excel, images, text/data files, and email text. When the CRM needs
higher-fidelity extraction such as layout-aware tables, image captions, HEIC
scan OCR, audio transcription, or video understanding, point the worker at a
hosted [OmniParse](https://github.com/mysticalsin/omniparse) instance.

## How it's wired

The worker text extractor (`apps/worker/src/lib/extract-text.ts`) is the single
choke point for every document parse: RFP intake, account intelligence, and bid
workspace extraction.

1. Direct text/data formats are parsed locally first.
2. Binary documents call OmniParse when `OMNIPARSE_BASE_URL` is set.
3. OmniParse requests use:
   - `POST {base}/parse_document` for PDF, Word, and PowerPoint.
   - `POST {base}/parse_media/image` for images and HEIC/HEIF scans.
   - `POST {base}/parse_media/audio` for audio.
   - `POST {base}/parse_media/video` for video.
4. If OmniParse is unset, unreachable, times out, returns invalid JSON, or
   returns no usable text, built-in CPU parsers continue where possible.

This is fail-open by design: OmniParse upgrades quality without becoming a hard
dependency for normal PDFs, Office docs, spreadsheets, images with local OCR, or
plain text files. Audio and video extraction require OmniParse because there is
no local transcription stack in this repo.

| Format                             | Built-in path                      | With OmniParse configured             |
| ---------------------------------- | ---------------------------------- | ------------------------------------- |
| PDF                                | `pdf-parse` plus optional OCRmyPDF | Layout, tables, OCR                   |
| DOCX                               | `mammoth`                          | Rich document parse                   |
| DOC                                | `word-extractor`                   | Rich document parse                   |
| PPTX                               | `node-pptx-parser`                 | Rich slide parse                      |
| PPT                                | best-effort text recovery          | Rich slide parse                      |
| XLSX/XLS                           | `@e965/xlsx` to CSV                | CPU path                              |
| Images                             | optional Tesseract                 | Captions and OCR, including HEIC/HEIF |
| Audio                              | requires OmniParse                 | Transcription                         |
| Video                              | requires OmniParse                 | Video parsing                         |
| TXT/CSV/JSON/XML/HTML/RTF/YAML/EML | direct UTF-8 text                  | direct UTF-8 text                     |

## Configuration

| Env var                | Default         | Purpose                                                               |
| ---------------------- | --------------- | --------------------------------------------------------------------- |
| `OMNIPARSE_BASE_URL`   | unset, disabled | Base URL of the OmniParse server, for example `http://omniparse:8000` |
| `OMNIPARSE_TIMEOUT_MS` | `60000`         | Per-document call timeout                                             |

Set these on the worker process. Leaving `OMNIPARSE_BASE_URL` unset keeps
everything on the built-in CPU parsers.

## Hosting OmniParse

OmniParse is a Python service intended to run as a separate Linux service, often
with GPU acceleration depending on the models enabled. Do not vendor it into the
Node workspace. Run it as a sidecar or external service and point
`OMNIPARSE_BASE_URL` at it.

Example shape:

```bash
docker run --gpus all -p 8000:8000 savatar101/omniparse:latest
# worker env:
# OMNIPARSE_BASE_URL=http://<host>:8000
```

Always verify the upstream image, model licenses, and hardware requirements
before production use.

## Verifying

With `OMNIPARSE_BASE_URL` set, upload a PDF, HEIC scan, audio file, or video in
`/intake` or the RFP pipeline and check the worker logs. A successful parse
returns markdown/text into the extraction job. To verify fallback behavior,
point the URL at an unreachable host and upload a text PDF or DOCX; extraction
should still complete through the local parser.
