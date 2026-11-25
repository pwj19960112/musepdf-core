# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-11-25

First public release of the MusePDF core: 60 client-side PDF tools under Apache-2.0.

### Added

- **Merge & Split** — merge, split, split in half, split by size, split by bookmarks, extract pages, delete pages, alternate & mix, combine to single page, organize pages.
- **Convert to PDF** — image, JPG, PNG, WebP, SVG, BMP, HEIC, TIFF, text, Word, Markdown, camera scan.
- **Convert from PDF** — JPG, PNG, WebP, BMP, TIFF, greyscale, text, CSV, Excel, Word, Markdown, ZIP, extracted images.
- **Organize** — duplicate & organize, rotate, n-up, reverse pages, add a blank page, page dimensions.
- **Secure** — encrypt, decrypt, change permissions, view metadata, remove metadata.
- **Optimize** — compress, fix page size, posterize.
- **Edit & Annotate** — page numbers, header & footer, watermark, invert colours, background colour, text colour, remove annotations, edit bookmarks, page labels, overlay.
- Per-tool static pages with their own title, description and structured data, generated at build time.
- English and Simplified Chinese UI, with a generated dictionary and a build-time check for untranslated strings.
- Vitest suite covering conversion logic, the page-model helpers and the localisation pipeline.
- Dockerfile, nginx config and Cloudflare Pages headers/redirects for self-hosting.

### Notes

- Advanced tools — the interactive editor workbench, annotation and stamping, text editing, signatures, form filling, OCR,PDF comparison, table-of-contents generation, Bates numbering, flattening and permission editing — are maintained separately and are **not** part of this release.
- This project is a derivative work of [BentoPDF](https://github.com/alam00000/bentopdf) (Apache-2.0). Upstream attribution and the required modification statements are in [NOTICE](./NOTICE) and [public/licenses.txt](./public/licenses.txt).
- Part of the editor lineage descends from [Stirling-PDF](https://github.com/Stirling-Tools/Stirling-PDF) (MIT); it is not included in this release, and its notice is retained.

[1.0.0]: https://github.com/pwj19960112/musepdf-core/releases/tag/v1.0.0
