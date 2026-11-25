# Contributing to MusePDF

Thanks for taking the time. This document covers the practical bits — what runs where, how to test, and the two rules that are not negotiable.

## Two rules that are not negotiable

1. **Files must not leave the browser.** Every tool in this repository runs client-side. A pull request that adds a server call, an analytics payload containing file content, or a third-party upload endpoint will be closed. This is the whole product.
2. **Keep the attribution.** `NOTICE`, `LICENSE` and `public/licenses.txt` carry the upstream licence notices (BentoPDF, Apache-2.0; Stirling-PDF, MIT). Apache-2.0 §4 makes keeping them a condition of redistributing this code. Do not delete, reword or "clean up" those files.

## Getting set up

```bash
git clone https://github.com/pwj19960112/musepdf-core.git
cd musepdf-core
npm install
npm run dev        # http://localhost:5173
npm run test:run   # vitest
```

Node 18 or newer. There is no backend, no database and no environment variables to configure.

## Where things live

| Path | What it is |
| --- | --- |
| `src/js/logic/` | One module per tool — takes a `File`, returns a `Blob` |
| `src/js/logic/lazy.ts` | Tool id → dynamic import, so each page loads only its own tool |
| `src/js/config/tools.ts` | Category and tool tables that drive the UI |
| `src/js/config/pdf-tools.ts` | Which loading strategy each tool needs |
| `src/js/handlers/` | File input, drag-and-drop, routing a file to the right tool |
| `seo/pages.meta.json` | **The single source of truth for the tool list and its count** |
| `seo/pages.copy.json` | Per-page copy: detail line, feature bullets, steps |
| `scripts/generate-seo-pages.mjs` | Renders one static HTML page per tool |
| `src/tests/` | Vitest suite |

Adding a tool means touching `pages.meta.json`, `tools.ts`, `pdf-tools.ts`, a module in `logic/`, and the copy file. The page generator fails the build if the copy and the page list disagree about the tool count, which is deliberate — it is how the count stays honest.

## Making a change

1. Fork the repository and branch from `main` (`fix/…`, `feat/…`).
2. Keep the change focused. One concern per pull request.
3. Add or update a test when you touch conversion logic — `npm run test:run` must pass.
4. Run `npm run build` before pushing. It type-checks and renders every page; a broken page template shows up there, not in `npm run dev`.
5. Open the pull request and describe **how you tested it**. "Ran it locally and merged two PDFs, output opened in Preview" is enough; a screenshot is better.

## Reporting a bug

Include:

- the tool and the URL,
- what you expected and what happened,
- the browser and version,
- **the PDF that reproduces it**, if you can share one. A file is worth ten descriptions. If the document is sensitive, reproduce the problem with a generated one — most page-structure bugs reproduce with any multi-page PDF.

Please do not attach documents containing personal data to a public issue.

## Commit messages

Plain and specific: what changed and why. `fix: keep page labels after split` beats `update code`.

## Contact

General questions and anything you would rather not post publicly: <https://musepdf.app/contact>.

## Code of conduct

Be decent. Assume the other person is acting in good faith until they prove otherwise. See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
