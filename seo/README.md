# MusePDF SEO layer — 61 tool landing pages + hub homepage

Every MusePDF tool now has its own indexable, statically routed page at `/<slug>/`, plus a
homepage that distributes all of them. The pages are not screenshots of the app and not iframes:
each page mounts the real tool through the existing `setupToolInterface()` machinery, so the page
**is** the tool.

```
/                       hub homepage — 61 tool cards, grouped, crawlable <a> links
/merge-pdf/             one page per tool (61 total)
/…
/sitemap.xml /robots.txt /llms.txt
```

## Regenerate

```bash
npm run seo:pages     # writes the 61 pages, homepage, sitemap, robots, llms.txt
npm run build         # seo:pages + tsc + vite build  → dist/
npm run seo:check     # audits dist/: titles, canonicals, JSON-LD, keyword placement, links, sitemap
node scripts/size-report.mjs   # first-load JS/CSS per page (raw + gzip) from the real chunk graph
```

## Design layer

The pages use a light theme (`src/css/theme.css`, `.hp-*` classes) whose tokens are:
white background, `#272E62` body text, `#006DFF` primary, `#F1EDFF` tool
cards, `#E7F1FF` section bands, 4/8/10px radii. The original dark skin (`styles.css` + `seo-pages.css`)
is untouched — removing the `theme.css` link from the generator restores it.

The tool markup in `src/js/ui.ts` still uses dark-theme utilities; a scoped bridge inside
`.hp-app` remaps them (bg-gray-800 → white, text-white → ink, indigo → `#006DFF`), so no template had
to be rewritten.

## First-load budget

Per-tool logic is loaded with a dynamic import (`src/js/logic/lazy.ts`), so a page fetches only its own
tool plus the libraries that tool actually uses. Measured with `scripts/size-report.mjs`:

| | before | after |
|---|---|---|
| JS per tool page (median) | 1,343 KB gzip | **288 KB gzip** |
| JS heaviest page | 1,343 KB (every page) | 671 KB (`/change-pdf-permissions/`, pdfkit) |
| Homepage JS | 0 (no interactivity) | 1.5 KB |
| CSS per page | 10.8 KB gzip | 11.4 KB gzip |

Do **not** add `manualChunks` groups — splitting vendors by hand made side-effect imports pull
heic2any into the merge chunk; Rollup's own splitting after the lazy imports is correct.


`scripts/generate-seo-pages.mjs` is deterministic: same inputs, same HTML. Vite picks the pages up
from `seo/pages.manifest.json` (written by the generator), so adding a tool to `seo/pages.meta.json`
is all it takes to publish another static route.

## Change the domain

`seo/site.config.json` holds `siteUrl`, `siteName`, social handles and the OG image path. Change
`siteUrl` and re-run `npm run seo:pages` — canonical, `og:url`, JSON-LD `url`/`item` fields, the
sitemap and `llms.txt` all follow. `https://example.com` is a placeholder.

## Data flow

| File | What it holds |
|---|---|
| `seo/pages.meta.json` | one row per page: slug, tool id, group, target keyword, input/output wording |
| `seo/pages.copy.json` | per-page unique copy: detail line, feature bullets, custom 3-step how-to |
| `seo/keywords.selected.json` | researched keyword per slug (primary, secondary, volume, KD) + optional title/H1/description overrides |
| `seo/tools.inventory.json` | tool names/subtitles scraped from `src/js/config/tools.ts` |
| `seo/research/` | raw OpenSEO MCP responses and the condensed keyword table |

Keyword research runs through the OpenSEO MCP server (`https://app.openseo.so/mcp`):

```bash
python scripts/oseo.py whoami
python scripts/oseo-research.py seo/research/seeds-batch1.json     # 5 seeds per call, ~54 credits each
```

Results land in `seo/research/keywords.json`; the chosen keyword per page goes into
`seo/keywords.selected.json`, which the generator reads (title, H1, meta description and JSON-LD
`keywords` then follow the data instead of a guess).

## SEO rules the generator enforces

On-page
- one `<h1>` per page, unique `<title>` (≤62 chars) and unique meta description (≤160 chars)
- primary keyword in the title, H1, meta description, URL slug and the first 120 words
- keyword density kept under ~3.5% (`npm run seo:check` warns above it)
- semantic structure: breadcrumb, `<h2>` sections, 3-step how-to, FAQ, related-tool links
- self-referencing canonical + `hreflang` (`en`, `x-default`) on every page

Rich results / GEO
- JSON-LD: `BreadcrumbList`, `WebApplication` (with `offers.price = 0`), `HowTo`, `FAQPage`
- homepage: `WebSite`, `Organization`, `ItemList` of all 59 tools, `FAQPage`
- `llms.txt` at the root for AI assistants, with a facts block they can quote
- `robots.txt` explicitly welcomes GPTBot, ClaudeBot, PerplexityBot and Google-Extended

Crawl / internal linking
- every page is reachable from the homepage and from the footer (7 grouped columns, 59 links)
- 6 related-tool links per page (same group first, then cross-group)
- sitemap covers the homepage and all 61 tool pages
- links are real `<a href>` elements — no JS-only navigation

Performance / UX
- static HTML for the whole chrome; only the tool itself is JavaScript
- no render-blocking scripts, fonts preconnected, `theme-color`, explicit `width`/`height` on the logo
- responsive down to 360px, keyboard-accessible FAQ (`<details>`), skip-link to the tool

## Verifying a page actually works

`npm run dev` then open `http://localhost:5173/merge-pdf/`. The tool renders through
`src/js/landing.ts`, which reads `data-tool` from `<body>` and calls `setupToolInterface()`.
