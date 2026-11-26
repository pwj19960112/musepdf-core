# MusePDF

**60 PDF tools that run entirely in your browser tab.** No upload, no account, no watermark. Every tool is client-side — the file never leaves your machine.

[![Stars](https://img.shields.io/github/stars/pwj19960112/musepdf-core?style=social)](https://github.com/pwj19960112/musepdf-core/stargazers)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

**[Try it: musepdf.app](https://musepdf.app)** · **[Self-host](#self-hosting)**

---

## Demo

![MusePDF demo — merge two PDFs, then retype a heading in the editor, all without uploading anything](docs/assets/musepdf-demo.gif)

*40 seconds: merge two documents, then retype a heading in place. Every step runs in the tab.* ([MP4 version](docs/assets/musepdf-demo.mp4))

> The hosted build at [musepdf.app](https://musepdf.app) ships 75 tools; this repository is the open-source subset of 60. The recording is against the hosted build.

---

## Why this exists

Most "free online PDF tools" upload your document to a server. For a contract, an ID scan, an invoice or a medical record, that is a real risk you cannot audit.

MusePDF does the work in the tab: PDF parsing, rendering, conversion and encoding all run on the device with WebAssembly and JavaScript. There is no backend for the tools in this repository.

### Verify it yourself in 30 seconds

Do not take the claim on trust — check the network tab:

1. Open <https://musepdf.app> and open DevTools → **Network**.
2. Drop in a PDF and run any tool in this repo.
3. Filter the request list for `POST` / `PUT` uploads. There are none. You will see only static asset loads from `musepdf.app`.

The same test works offline: load a tool page, then turn off your network and run the tool.

---

## What is in this repository

60 tools, grouped as they are on the site:

| Group | Tools |
| --- | --- |
| **Merge & Split** | merge, split, split in half, split by size, split by bookmarks, extract pages, delete pages, alternate & mix, compare-free combine, organize |
| **Convert to PDF** | image, JPG, PNG, WebP, SVG, BMP, HEIC, TIFF, text, Word, Markdown, scan |
| **Convert from PDF** | JPG, PNG, WebP, BMP, TIFF, greyscale, text, CSV, Excel, Word, Markdown, ZIP, extract images |
| **Organize** | duplicate & organize, rotate, n-up, combine to single page, reverse, add blank page, page dimensions |
| **Secure** | encrypt, decrypt, change permissions, remove metadata, view metadata |
| **Optimize** | compress, fix page size, posterize |
| **Edit & Annotate** | page numbers, header & footer, watermark, invert colours, background colour, text colour, remove annotations, bookmarks, page labels, overlay |

> **What is not here.** A further set of 15 advanced tools — the interactive editor workbench, annotation and stamping, text editing, signatures, form filling, OCR, document comparison, table-of-contents generation, Bates numbering, flattening and permission editing — is developed separately and is not part of this Apache-2.0 release. The public site runs both the open tools and those commercial ones.

---

## Quick start

```bash
git clone https://github.com/pwj19960112/musepdf-core.git
cd musepdf-core
npm install
npm run dev          # http://localhost:5173
```

Production build:

```bash
npm run build        # writes dist/
npm run preview      # serve dist/ on :4173
```

Requirements: Node 18 or newer. There is no server to configure — `dist/` is a static site.

### Tests

```bash
npm run test:run     # vitest, 200+ tests
```

The suite covers the conversion logic, the PDF page-model helpers and the localisation pipeline. It runs in jsdom; no network access is required.

## Self-hosting

`dist/` is plain static files. Serve it from anything.

```bash
docker build -t musepdf .
docker run -p 3000:8080 musepdf
```

Or with Compose:

```bash
docker compose up -d --build
```

The image is nginx serving the built `dist/`. Both `nginx.conf` and `Dockerfile` are in the repository. There is no official image on Docker Hub — build it yourself so you know what you are running.

Deploying to Cloudflare Pages works as-is: build with `npm run build` and publish `dist/`. `public/_headers` and `public/_redirects` are picked up automatically.

---

## How it works

No framework magic; the tools are ordinary modules that take a `File` and hand back a `Blob`.

- **pdf-lib** — page tree edits, metadata, encryption, form fields, page insertion and reordering
- **PDF.js** — rendering to canvas, text-layer extraction, thumbnails
- **Tesseract.js** — OCR in a worker (used by the commercial OCR tool, not included here)
- **WASM codecs** — HEIC, TIFF and image transcoding without touching a server
- **Vite** — one entry per tool page, so a visitor downloads only the tool they opened
- **TypeScript** throughout, with the conversion logic under test

The site is generated: `scripts/generate-seo-pages.mjs` renders one static HTML page per tool from `seo/pages.meta.json` and the bilingual copy files, which is why every tool has a real URL with its own title, description and structured data.

---

## Licence and provenance

Apache License 2.0 — see [LICENSE](./LICENSE).

This project is a derivative work. It began from **BentoPDF** (<https://github.com/alam00000/bentopdf>, Apache-2.0) and its tool implementations, configuration tables and build setup descend from that project. It also incorporates work derived from **Stirling-PDF** (MIT, © Stirling PDF Inc.) in the editor lineage that is not part of this release.

Attribution, the list of modified upstream files and the modification statements required by Apache-2.0 §4 are in [NOTICE](./NOTICE) and [public/licenses.txt](./public/licenses.txt). **If you fork this repository, keep those files.** They are a licence condition, not documentation.

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md). Bug reports that come with a PDF that reproduces the problem get looked at first.
