/**
 * Deterministic SEO page generator for the MusePDF tool landing pages.
 *
 *   node scripts/generate-seo-pages.mjs
 *
 * Inputs
 *   seo/site.config.json        site name / URL / social defaults
 *   seo/pages.meta.json         one row per landing page (slug, tool id, target keyword)
 *   seo/pages.copy.json         per-page unique copy (detail line, feature bullets, steps)
 *   seo/keywords.selected.json  optional: researched keyword + title/H1/description overrides
 *   seo/tools.inventory.json    tool names/subtitles scraped from src/js/config/tools.ts
 *
 * Outputs (all under the repo root, so Vite builds them as extra MPA entries)
 *   <slug>/index.html           one tool landing page per slug
 *   index.html                  homepage / hub that distributes every tool
 *   sitemap.xml robots.txt llms.txt
 *   seo/pages.manifest.json     input map consumed by vite.config.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p, fallback = null) => {
  const abs = path.join(ROOT, p);
  return fs.existsSync(abs) ? JSON.parse(fs.readFileSync(abs, 'utf8')) : fallback;
};
const write = (p, content) => {
  const abs = path.join(ROOT, p);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  return abs;
};

const cfg = read('seo/site.config.json');
const meta = read('seo/pages.meta.json');
const copy = read('seo/pages.copy.json', {});
const selected = read('seo/keywords.selected.json', {});
const inventory = read('seo/tools.inventory.json', { unique: {} });
/** Hand-authored Chinese copy. The ONLY file to edit to change what the 中文 switch shows. */
const ZH = read('seo/i18n.zh.json', {}) || {};
/**
 * Hand-authored 简体中文 metadata for the PRE-RENDERED `/zh/**` pages (seo/zh.pages.json): the Chinese
 * <title> / meta description / <h1> / HowTo name per tool, plus the long-tail FAQ templates. The copy
 * that the two languages share lives in seo/i18n.zh.json (keyed by the English string); this file is
 * only what the Chinese pages say differently from a translation of the English page.
 */
const ZHP = read('seo/zh.pages.json', { home: {}, support: {}, tools: {}, longTailTemplates: {} });
/** Curated per-slug search aliases (seo/search.aliases.json), merged into the homepage search index. */
const ALIASES = read('seo/search.aliases.json', {}) || {};
const SITE = cfg.siteUrl.replace(/\/$/, '');
const YEAR = new Date().getFullYear();

/* ------------------------------------------------------------------ Google Tag Manager */

/**
 * ONE config spot for analytics: `analytics` in seo/site.config.json. Everything else reads it from
 * the `<meta>` tags this generator emits, which are also the config channel between the generator and
 * `src/js/analytics.ts`.
 *
 *   gtmContainerId    the Google Tag Manager container (the owner's real one).
 *   ga4MeasurementId  a GA4 measurement id; if it is a real id, events are also sent straight to GA4
 *                     through gtag so there is data before the container's tags are configured.
 *                     `G-XXXXXXXXXX` is the placeholder and turns that fallback off.
 *   consentMode       `cookieless` (shipped: consent defaults denied, no cookie, no banner needed) or
 *                     `full` (granted defaults — needs a real EU consent banner; do NOT ship it blind).
 *
 * While BOTH ids are still placeholders the analytics module does NOTHING at all. No `<noscript>`
 * GTM iframe is emitted: it is an unconditional third-party request and only serves JS-disabled
 * visitors.
 */
const GTM_ID = String(cfg.analytics?.gtmContainerId || '').trim();
const GA_ID = String(cfg.analytics?.ga4MeasurementId || '').trim();
const CONSENT_MODE = String(cfg.analytics?.consentMode || 'cookieless').trim();

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const attr = esc;
const url = (slug) => `${SITE}/${slug}/`;

/** The head tags every page carries: the config channel between seo/site.config.json and the module. */
/** True when seo/site.config.json still holds the placeholder id. */
const GA_PLACEHOLDER = /^G-X+$/.test(String(GA_ID || '').trim());
const GA_META = GA_PLACEHOLDER
  ? '<!-- seo:analytics -->'
  : `<!-- seo:analytics -->
    <meta name="gtm-container-id" content="${attr(GTM_ID)}">
    <meta name="ga4-measurement-id" content="${attr(GA_ID)}">
    <meta name="analytics-consent-mode" content="${attr(CONSENT_MODE)}">
    <!-- Google tag (gtag.js) — official snippet, in <head> so it is visible in view-source -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=${attr(GA_ID)}"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', '${attr(GA_ID)}');
      window.__musepdfGaHead = true;
    </script>`;

/**
 * The deferred loader bootstrap: an inline, dependency-free script that wakes `src/js/analytics.ts`
 * once the page has painted (requestIdleCallback after `load`) or on the first real interaction
 * (`pointerdown` / `keydown`), whichever comes first. Not a module and not a linked chunk: nothing
 * about it is part of a page's first-load graph, and gtm.js is only requested by the module it wakes.
 *
 * The `import()` specifier is built at runtime from a variable (see the comment inside) so Vite's
 * HTML pass leaves it alone; the loader itself is a separate build entry (`assets/analytics.js`,
 * declared in vite.config.ts) that no page links as a first-load module. The import is inside a
 * `try` so a browser that cannot load it — or an offline visitor — simply has no analytics.
 */
const GA_BOOT = `    <!-- seo:analytics-boot -->
    <script>
    (function () {
      function meta(name) { var m = document.querySelector('meta[name="' + name + '"]'); return m ? (m.getAttribute('content') || '').trim() : ''; }
      var gtm = meta('gtm-container-id');
      var ga4 = meta('ga4-measurement-id');
      var hasGtm = gtm && !/^GTM-X+$/i.test(gtm);
      var hasGa4 = ga4 && !/^G-X+$/i.test(ga4);
      if (!hasGtm && !hasGa4) return; // nothing configured → nothing is even fetched
      var done = false;
      function wake() {
        if (done) return;
        done = true;
        var src = '/assets/analytics-v2.js'; // a variable: Vite inlines LITERAL import()s in classic scripts
        try { import(src).catch(function () {}); } catch (error) { /* no analytics is a valid outcome */ }
      }
      var idle = window.requestIdleCallback || function (fn) { return setTimeout(fn, 2500); };
      addEventListener('load', function () { idle(wake); }, { once: true });
      addEventListener('pointerdown', wake, { once: true, passive: true });
      addEventListener('keydown', wake, { once: true });
    })();
    </script>`;

/* ------------------------------------------------------------------ page model */

const GROUPS = ['Merge & Split', 'Convert to PDF', 'Convert from PDF', 'Edit & Annotate', 'Organize', 'Optimize', 'Secure'];
const GROUP_BLURB = {
  'Merge & Split': 'Combine, cut and reorder documents without uploading them anywhere.',
  'Convert to PDF': 'Turn images, text and office files into clean PDFs in the browser.',
  'Convert from PDF': 'Pull pages out of a PDF as images, text or archives.',
  'Edit & Annotate': 'Mark up, sign, stamp and restyle a PDF before you send it.',
  Organize: 'Reorder, duplicate and lay out pages so the document prints the way you want.',
  Optimize: 'Shrink, resize and clean up PDFs so they load fast and print right.',
  Secure: 'Lock, unlock and scrub documents before they leave your machine.',
};

const pages = meta.map((m) => {
  const tool = inventory.unique?.[m.id] || {};
  const c = copy[m.slug] || {};
  // Four tool ids have no inventory row (word / markdown / scan): fall back to the keyword's title case
  // ("word to pdf" → "Word to PDF") rather than the raw slug, which would leak "word-to-pdf" into the
  // breadcrumb, the cards and the footer links.
  //
  // `name` in seo/pages.copy.json overrides all of it: a second page for an existing tool id (e.g.
  // /edit-text-in-pdf/ on the `edit` workbench) must not be called "PDF Editor" in the breadcrumb and the
  // footer, because the tool it reuses already is.
  const name = c.name || tool.name || titleize(m.kw);
  const sel = selected[m.slug] || {};
  const kw = sel.primary || m.kw;
  const title = sel.title || buildTitle(kw);
  const h1 = sel.h1 || (kw.startsWith('how to ') || kw.startsWith('how do i ')
    ? `${titleize(kw)} (Free, No Signup, No Upload)`
    : `${titleize(kw)} Online — Free and Private`);
  const description = sel.description ||
    `${titleize(kw)} in your browser: ${c.d ? c.d.replace(/\.$/, '') : `turn ${m.in} into ${m.out}`}. No upload for this tool, no signup, no watermark.`;
  return {
    ...m,
    name,
    subtitle: c.subtitle || tool.subtitle || '',
    kw,
    secondary: sel.secondary || [],
    volume: sel.volume ?? null,
    kd: sel.kd ?? null,
    title: clamp(title, 62),
    h1,
    description: clamp(description, 158),
    detail: c.d || `Turn ${m.in} into ${m.out} — entirely on your own device.`,
    features: c.f || [],
    steps: c.steps || null,
    faq: c.faq || [],
    // One plain anchor under the group note, pointing at the page that does the sibling job (see toolPage).
    seeAlso: c.seeAlso || null,
    // Optional deep-dive sections: added to an existing page without touching its title, H1 or intro.
    sections: c.sections || [],
  };
});

function titleize(s) {
  const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with', 'into', 'per']);
  return s.split(/\s+/).map((word, i) => {
    const lower = word.toLowerCase();
    const fixed = { pdf: 'PDF', jpg: 'JPG', jpeg: 'JPEG', png: 'PNG', webp: 'WebP', heic: 'HEIC', tiff: 'TIFF',
      bmp: 'BMP', svg: 'SVG', txt: 'TXT', ocr: 'OCR', zip: 'ZIP', docx: 'DOCX', n: 'N', up: 'Up',
      csv: 'CSV', xls: 'XLS', xlsx: 'XLSX', md: 'MD', json: 'JSON', xml: 'XML', html: 'HTML' };
    if (fixed[lower]) return fixed[lower];
    if (i > 0 && SMALL.has(lower)) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(' ').replace(/\bN Up\b/g, 'N-Up');
}
function clamp(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 20)) + '…';
}

const GROUP_NOTE = {
  'Merge & Split': (p) => `Use ${p.name} when a document needs to be reshaped rather than rewritten — assembling a report from several PDFs, pulling one chapter out of a 200-page manual, or dropping the blank backs a scanner added. Because everything is processed page by page on your own machine, the file sizes and page counts you can handle are limited by your browser, not by an upload quota.`,
  'Convert to PDF': (p) => `Teams usually reach for ${p.name} when a file has to become something a reviewer, a printer or an archive can open without extra software. The conversion writes standard PDF pages, so the result opens the same way in Acrobat, Preview, Chrome, Word and every print shop's RIP. Original resolution is preserved — no re-compression, no quality loss beyond what the source file already had.`,
  'Convert from PDF': (p) => `Recovering content from a PDF is normally painful because the format stores pages, not editable text. ${p.name} renders the page and hands you back the right output for reuse — a screenshot-ready image, a text file for a docs pipeline, or an archive for storage. Nothing is uploaded, so published reports, signed contracts and internal decks stay confidential.`,
  'Edit & Annotate': (p) => `Most edits to a PDF are last-minute: a missing signature, a highlight for a colleague, a page number on a contract. ${p.name} handles those on the spot without a desktop install, an account or a subscription. Annotated output is flattened into the page, so the recipient sees exactly what you saw regardless of the reader they use.`,
  Organize: (p) => `Page order is usually the difference between a document that makes sense and one that does not — a scan split across a duplex feeder, an export with the cover in the middle, a print job that wastes paper. ${p.name} rearranges the pages visually, so you confirm the result before you export instead of guessing at a page range syntax.`,
  Optimize: (p) => `Large PDFs break email limits, portal uploads and slow connections. ${p.name} rebuilds the file on your device, so the wait is your own CPU rather than an upload queue, and the optimised copy stays private — useful when the document contains client data that should not sit in a third-party converter's storage.`,
  Secure: (p) => `Before a document leaves your organisation you usually want one of two things: a lock on it, or the traces removed from it. ${p.name} applies that change locally, which matters because the file and the password never travel over the network. Keep an unencrypted master copy — passwords on PDFs are easy to lose.`,
};

/**
 * Per-slug override for the group note. The shared "Edit & Annotate" note promises that annotated
 * output is flattened into the page — true for the restyle/sign tools it was written for, but not a
 * claim these two pages can back yet (their interactive modes ship in a later batch). An override
 * says only what the page actually does, in both languages (`groupNotes[slug]` in seo/i18n.zh.json).
 */
const GROUP_NOTE_OVERRIDE = {
  'annotate-pdf': (p) => `${p.name} is for the last read before a document goes out: highlight the sentences that matter, leave a comment in the margin, and mark what needs a second look. You mark up the pages you uploaded, and the file is read locally in your browser — so client drafts and internal reports stay on your machine.`,
  'stamp-pdf': (p) => `${p.name} marks a document's status where a reviewer will actually see it — DRAFT, APPROVED, RECEIVED, or a label of your own. You place the stamp on the pages you choose, and because the document is opened locally, neither the file nor the label is uploaded anywhere.`,
  'edit-text-in-pdf': (p) => `${p.name} is for the correction that has to happen before a document goes out: a name spelt wrong, a price that has changed, a date that moved. You change the words that are already on the page and keep the rest of the document as it was, and the file is opened in your browser — so the document is never uploaded.`,
};

/** Keep titles inside the ~60-char SERP budget without ever cutting mid-word. */
function buildTitle(kw) {
  const t = titleize(kw);
  const informational = kw.startsWith('how to ') || kw.startsWith('how do i ');
  for (const candidate of [
    informational ? `${t} — Free Online PDF Tool` : `${t} — Free, Private, No Signup`,
    `${t} — Free Online Tool`,
    `Free ${t} — No Signup, No Upload`,
    t,
  ]) {
    if (candidate.length <= 62) return candidate;
  }
  return clamp(t, 62);
}
const bySlug = Object.fromEntries(pages.map((p) => [p.slug, p]));
const groupOf = (g) => pages.filter((p) => p.group === g);

/**
 * THE tool count — the single source of truth for every number on the site.
 *
 * Nothing in this file, in the support pages or in seo/i18n.zh.json types a count. Copy that needs it
 * carries a `{n}` token and is filled from here (`c()` / `tpl()` fill both the English string and its
 * Chinese translation), and `assertToolCount()` at the bottom of this file fails the build if any
 * generated page still shows a number that does not match this one. Adding a page to
 * seo/pages.meta.json is therefore the ONLY edit needed to move "61 tools" to "62".
 *
 * `rest` is the "and N more" companion: the homepage lists eight tools by name in its how-it-works
 * copy, so the remainder is derived rather than written down.
 */
const TOOL_COUNT = pages.length;
const NAMED_ON_HOMEPAGE = 8;

/* ------------------------------------------------------------- the Chinese page set */

/**
 * Every English page has exactly one Chinese twin, and the pair is what hreflang, the language switch
 * and the sitemap all point at. The English support pages are FILES (`/about.html`) while their
 * Chinese twins are directories (`/zh/about/`), so the mapping is explicit rather than derived.
 */
const SUPPORT_PAGES = ['about', 'faq', 'contact', 'privacy', 'terms'];
const SUPPORT_TWINS = Object.fromEntries(SUPPORT_PAGES.map((name) => [`/${name}.html`, `/zh/${name}/`]));
/** The Chinese path for an English pathname, or null when the target is not a page (assets, .txt). */
function zhPath(pathname) {
  if (pathname === '/' || pathname === '/index.html') return '/zh/';
  if (SUPPORT_TWINS[pathname]) return SUPPORT_TWINS[pathname];
  // The /vs/ comparison set lives outside seo/pages.meta.json (scripts/generate-compare-pages.mjs writes
  // it), so its twins are not in `bySlug`: mirror the nesting instead of leaving the link on the English
  // page from a Chinese footer or a Chinese comparison page.
  const compare = /^\/(vs(?:\/[a-z0-9-]+)?)\/?$/.exec(pathname);
  if (compare) return `/zh/${compare[1]}/`;
  const m = /^\/([a-z0-9-]+)\/?$/.exec(pathname);
  if (m && bySlug[m[1]]) return `/zh/${m[1]}/`;
  return null;
}
/** Absolute URLs for one page's two language versions. */
const altsFor = (slug) => ({
  en: slug ? `${SITE}/${slug}/` : `${SITE}/`,
  zh: slug ? `${SITE}/zh/${slug}/` : `${SITE}/zh/`,
});
const altsForSupport = (name) => ({ en: `${SITE}/${name}.html`, zh: `${SITE}/zh/${name}/` });
/**
 * The same pair as ROOT-RELATIVE paths. That is what the EN / 中文 control links to, so the switch
 * works on any host the site is served from (preview server, localhost, a Pages preview URL) instead
 * of jumping to production. hreflang, og:url and the canonical keep the absolute URLs.
 */
const langPathsFor = (slug) => (slug ? { en: `/${slug}/`, zh: `/zh/${slug}/` } : { en: '/', zh: '/zh/' });
const langPathsForSupport = (name) => ({ en: `/${name}.html`, zh: `/zh/${name}/` });

const EN_HTML = new Map();

/* ------------------------------------------------------------------- i18n (EN / 中文) */

/**
 * The Chinese dictionary is built at the exact place every English string is emitted, so a key can never
 * drift from the copy it translates: `reg(en, zh)` pairs them, and the runtime matches DOM text against
 * that same English string. Static chrome strings are looked up by their English text (`c`); tool-page
 * copy comes from the per-slug block. Both live in seo/i18n.zh.json.
 *
 * The result is written to public/i18n/zh.json, which src/js/i18n/init.ts fetches only when Chinese is
 * actually selected — no Chinese copy is in any first-load chunk, and the English HTML is untouched.
 */
const DICT = new Map();
const ATTR_DICT = new Map();
/**
 * Every English string that still has no Chinese, keyed by the English text and annotated with the
 * context it was emitted from (`chrome`, `home`, `page:<slug>`). This is the authoring backlog: feeding
 * it back into seo/i18n.zh.json is what makes the 中文 switch complete, and `make-zh-dictionary.mjs`
 * refuses to ship a dictionary that leaves one of these untranslated (or un-listed in `keepEnglish`).
 */
const MISS = new Map();
/** Which part of the site the string currently being emitted belongs to. */
let CTX = 'chrome';
const normKey = (s) => String(s).replace(/\s+/g, ' ').trim();
const fill = (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k])));

function note(en) {
  const key = normKey(en);
  if (!key) return;
  if (!MISS.has(key)) MISS.set(key, []);
  const where = MISS.get(key);
  if (!where.includes(CTX)) where.push(CTX);
}
/** All the strings the generator emits for one tool page carry that page's slug as their context. */
function inContext(context, build) {
  const previous = CTX;
  CTX = context;
  try {
    return build();
  } finally {
    CTX = previous;
  }
}

/** Pair an emitted English string with its Chinese; returns the English so call sites read normally. */
function reg(en, zhText) {
  const key = normKey(en);
  if (!key) return en;
  if (!zhText) {
    note(key);
    return en;
  }
  const prev = DICT.get(key);
  if (prev !== undefined && prev !== zhText) {
    throw new Error(`i18n: one English string, two Chinese translations:\n  ${key}\n  A: ${prev}\n  B: ${zhText}`);
  }
  DICT.set(key, zhText);
  return en;
}

/**
 * Static chrome / homepage string: Chinese is `strings.<English>` in seo/i18n.zh.json.
 *
 * A string carrying a `{n}` (or `{rest}`) token is a TEMPLATE: it is the dictionary key in
 * seo/i18n.zh.json (`"The {n} local tools are free…"`) and both sides are filled from PAGE_VARS here,
 * so the count is typed nowhere and the rendered pair — the exact English a visitor sees and its
 * Chinese — is what ends up in the EN → 中文 dictionary.
 */
const c = (en) => {
  const zhT = ZH.strings?.[en];
  if (!/\{\w+\}/.test(en)) return reg(en, zhT);
  const filledEn = fill(en, PAGE_VARS);
  if (zhT === undefined) {
    note(normKey(filledEn));
    return filledEn;
  }
  return reg(filledEn, fill(zhT, PAGE_VARS));
};

/** Visible attribute value (placeholder / aria-label / title). */
function a(en) {
  const zhText = ZH.attrs?.[en];
  if (zhText === undefined) {
    note(`attr: ${normKey(en)}`);
    return en;
  }
  ATTR_DICT.set(normKey(en), zhText);
  return en;
}

/**
 * Emit a template pair. English templates use `{kw} {name} {in} {out}`, Chinese ones the `…Zh` variants
 * (and `{nameZh}` for a translated tool name), so word order and phrasing stay each language's own.
 */
function tpl(enTemplate, zhTemplate, vars) {
  if (zhTemplate === undefined || zhTemplate === null) {
    note(fill(enTemplate, vars));
    return fill(enTemplate, vars);
  }
  return reg(fill(enTemplate, vars), fill(zhTemplate, vars));
}

/** The Chinese block for one tool page. */
const zp = (p) => ZH.pages?.[p.slug] ?? {};
function zField(p, field) {
  const value = zp(p)[field];
  if (value === undefined) note(`[${p.slug}] ${field}`);
  return value;
}

/** Chinese for a template, or '' (and a missing-entry note) when seo/i18n.zh.json has none yet. */
function zfill(template, vars, marker) {
  if (template === undefined || template === null) {
    note(marker);
    return '';
  }
  return fill(template, vars);
}

/** Template variables: English plain, Chinese suffixed with `Zh`. */
function varsFor(p) {
  const z = zp(p);
  return {
    kw: p.kw, name: p.name, in: p.in, out: p.out, n: TOOL_COUNT,
    site: cfg.siteName, tagline: cfg.tagline, year: YEAR, detail: p.detail,
    nameZh: z.name ?? '', inZh: z.in ?? '', outZh: z.out ?? '', detailZh: z.detail ?? '',
  };
}
const PAGE_VARS = {
  site: cfg.siteName, siteZh: ZH.strings?.[cfg.siteName] ?? cfg.siteName, tagline: cfg.tagline,
  year: YEAR, n: TOOL_COUNT, rest: TOOL_COUNT - NAMED_ON_HOMEPAGE,
};

/**
 * The EN / 中文 control — two REAL LINKS, one per pre-rendered page set. `src/js/i18n/init.ts` only
 * paints which side is current; the click is ordinary navigation (and works with JavaScript disabled).
 * Both languages are emitted on both pages, so the pair is symmetric: on an English page `中文` points
 * at the same slug under `/zh/`, and on a Chinese page `EN` points back at the English URL.
 */
function langSwitch({ lang = 'en', en, zh }) {
  const current = (side) => (side === lang ? ' aria-current="page"' : '');
  return `<div class="lang-switch" data-lang-switch role="group" aria-label="${attr(a('Language'))}">
                    <a class="lang-switch-btn" data-lang="en" href="${attr(en)}"${current('en')}>EN</a>
                    <a class="lang-switch-btn" data-lang="zh" href="${attr(zh)}"${current('zh')}>中文</a>
                </div>`;
}

/** Boot script for pages whose own entry point does not import the i18n runtime. */
const LANG_SCRIPT = '<script type="module" src="/src/js/i18n/boot.ts"></script>';

/* ------------------------------------------------------------------- copy bits */

const STEPS = {
  'merge-pdf': ['Add your PDFs', 'Drag the files in and reorder them in the list so the first file ends up first.'],
  'pdf-to-jpg': ['Add the PDF and pick a quality', 'Higher quality means sharper pages and larger JPGs.'],
  'compress-pdf': ['Choose how hard to compress', 'Pick the compression level, then let the browser rebuild the file.'],
  'sign-pdf': ['Draw, type or upload your signature', 'Place it on the page and drag the handles to resize it.'],
  'fill-pdf-form': ['Click each field', 'Type into the form fields just like a printed form, then tab through them.'],
  'ocr-pdf': ['Pick the document language', 'Choosing the right language makes the OCR text far more accurate.'],
  'protect-pdf': ['Set a password', 'Add a password and choose which permissions you want to restrict.'],
  'unlock-pdf': ['Enter the current password', 'The file is decrypted locally — the password never leaves the page.'],
  'edit-pdf': ['Annotate the page', 'Highlight, add text boxes, draw shapes or drop in images.'],
  'word-to-pdf': ['Drop in your .docx file', 'Paragraphs, tables and images are laid out on real PDF pages.'],
  'crop-pdf': ['Drag the crop box', 'Pull the handles in to the content, then apply the crop to every page.'],
  'n-up-pdf': ['Pick pages per sheet', 'Set 2, 4 or more pages per sheet and choose the arrangement.'],
  'posterize-pdf': ['Choose the tile grid', 'Split a big page into printable A4 or Letter tiles you can tape together.'],
};

/** "a PDF with one page per image" -> "PDF with one page per image", so "Save your …" reads well. */
function outPhrase(p) {
  return p.out
    .replace(/^(a|an|the|one|your)\s+/i, '')
    .replace(/^same\s+/i, 'updated ');
}

function stepsFor(p) {
  if (p.steps) return p.steps.map((s) => Array.isArray(s) ? s : [s, '']);
  if (STEPS[p.slug]) {
    return [STEPS[p.slug], ['Adjust if you need to', `Preview the result before you save your ${outPhrase(p)}.`], ['Download the result', `Save your ${outPhrase(p)} straight to your device — nothing was uploaded.`]];
  }
  return [
    [`Add your ${p.in}`, 'Drag and drop them, or click to browse. Files stay on your device.'],
    ['Adjust the options', `Set the options that decide the shape of your ${outPhrase(p)}.`],
    ['Download the result', `Save your ${outPhrase(p)} straight to your device.`],
  ];
}

const FAQ_VARIANTS = [
  {
    free: () => ({ q: 'Is this tool really free?', a: 'Yes. Every tool here is free with no account, no trial and no watermark. There is no daily limit and no paywalled export — the whole toolkit is open source.' }),
    privacy: (p) => ({ q: 'Are my files uploaded to a server?', a: `No. ${p.name} runs in your browser with JavaScript and WebAssembly, so your ${p.in} are processed on your device and nothing is uploaded for this tool. That matters for contracts, invoices, IDs and anything under an NDA.` }),
  },
  {
    free: () => ({ q: 'What does it cost?', a: 'Nothing. You get the full tool with no signup, no email and no watermark, and there is no limit on how many files you process.' }),
    privacy: () => ({ q: 'Where are my files processed?', a: 'In your own browser tab. Nothing is uploaded to a server, so your files stay on your machine — close the tab and the data is gone.' }),
  },
  {
    free: () => ({ q: 'Do I need an account to use it?', a: 'No account, no email and no credit card. Open the page, add your file and download the result.' }),
    privacy: () => ({ q: 'Is this safe for confidential documents?', a: 'Yes. The work happens locally, so no copy of your document is stored anywhere. There is no upload step to leak and no server-side queue to wait in.' }),
  },
];

function faqsFor(p) {
  const variantIndex = pages.indexOf(p) % FAQ_VARIANTS.length;
  const variantZh = (ZH.faq?.variants ?? [])[variantIndex] ?? {};
  const v = varsFor(p);
  const extraZh = Array.isArray(zp(p).faq) ? zp(p).faq : [];
  const specific = { q: `What do I get back after using ${p.name}?`, a: `You get ${p.out}.` };
  const quality = {
    q: 'Does it work on a phone, and can I use it offline?',
    a: 'Yes. The page works in any modern browser on desktop, tablet or phone, and once it has loaded it keeps working with no connection.',
  };
  const variant = FAQ_VARIANTS[variantIndex];
  const free = variant.free(p);
  const privacy = variant.privacy(p);
  const extra = p.faq.map(([q, a], i) => ({
    q, a, zq: extraZh[i]?.[0] ?? '', za: extraZh[i]?.[1] ?? '',
  }));
  return [
    ...extra,
    { q: specific.q, a: specific.a, zq: zfill(ZH.faq?.specificQ, v, specific.q), za: zfill(ZH.faq?.specificA, v, specific.a) },
    { q: free.q, a: free.a, zq: zfill(variantZh.freeQ, v, free.q), za: zfill(variantZh.freeA, v, free.a) },
    { q: privacy.q, a: privacy.a, zq: zfill(variantZh.privacyQ, v, privacy.q), za: zfill(variantZh.privacyA, v, privacy.a) },
    { q: quality.q, a: quality.a, zq: ZH.faq?.qualityQ, za: ZH.faq?.qualityA },
  ];
}

/* ---------------------------------------------------------------- HTML partials */

/* Fonts are self-hosted now (see src/css/fonts.css, imported by styles.css/theme.css). The three
   <link>s that pointed at fonts.googleapis.com/fonts.gstatic.com were removed: the site makes no
   third-party font request, and the brand face (DM Sans) ships from /fonts/*.woff2. */

/**
 * One icon set for every page the generator owns and its hand-written support pages.
 * The vector master stays /images/favicon.svg; the rasters come from `node scripts/make-favicons.mjs`
 * (headless Chrome → PNGs, Pillow → the .ico). This repo ships no web-app manifest, so none is
 * invented here — only the plain <link rel="icon"> family browsers actually consume.
 */
const ICONS = `<!-- seo:icons -->
    <link rel="icon" type="image/svg+xml" href="/images/favicon.svg">
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png">
    <link rel="shortcut icon" href="/favicon.ico">
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">`;

/**
 * The header mark, inlined from public/images/brand-mark-current.svg: currentColor fills plus
 * evenodd knock-outs, so one file follows the text colour (ink in the light header, white in the
 * dark footer band) with no extra request and no CSS. Reading the file rather than retyping the
 * geometry keeps the mark defined in exactly one place; if it is missing the lockup degrades to
 * text only instead of failing the build.
 */
const MARK_FILE = path.join(ROOT, 'public', 'images', 'brand-mark-current.svg');
function brandMark(size = 28) {
  if (!fs.existsSync(MARK_FILE)) return '';
  return fs.readFileSync(MARK_FILE, 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .replace('<svg ', '<svg aria-hidden="true" focusable="false" ')
    .replace('width="32" height="32"', `width="${size}" height="${size}"`)
    .trim();
}

function head({ title, description, canonical, jsonLd, extra = '', ogLocale = 'en_US', alternates = null, css = ['/src/css/styles.css', '/src/css/seo-pages.css'] }) {
  /**
   * Every page carries the full reciprocal hreflang triple. `en` and `x-default` point at the English
   * page, `zh-CN` at its Chinese twin — the same three on BOTH sides of the pair, which is what makes
   * them reciprocal. scripts/seo-check.mjs asserts it for every page.
   */
  const alt = alternates ?? { en: canonical, zh: canonical, xDefault: canonical };
  return `<meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(title)}</title>
    <meta name="description" content="${attr(description)}">
    <link rel="canonical" href="${attr(canonical)}">
    <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
    <meta name="theme-color" content="${attr(cfg.themeColor)}">
    ${GA_META}
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="${attr(cfg.siteName)}">
    <meta property="og:title" content="${attr(title)}">
    <meta property="og:description" content="${attr(description)}">
    <meta property="og:url" content="${attr(canonical)}">
    <meta property="og:image" content="${attr(SITE + cfg.ogImage)}">
    <meta property="og:locale" content="${attr(ogLocale)}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:site" content="${attr(cfg.twitter)}">
    <meta name="twitter:title" content="${attr(title)}">
    <meta name="twitter:description" content="${attr(description)}">
    ${ICONS}
    <!-- seo:hreflang -->
    <link rel="alternate" hreflang="en" href="${attr(alt.en)}">
    <link rel="alternate" hreflang="zh-CN" href="${attr(alt.zh)}">
    <link rel="alternate" hreflang="x-default" href="${attr(alt.xDefault ?? alt.en)}">
    <!-- /seo:hreflang -->
    ${css.map((href) => `<link href="${href}" rel="stylesheet">`).join('\n    ')}
    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>${extra}`;
}

/**
 * GitHub star entry point for the site header.
 *
 * Self-contained on purpose: the generated tool pages take their CSS from the hashed bundle, but the
 * hand-written support pages (about/faq/…) carry their own inline styles and load no stylesheet, so a
 * badge built here needs its own style block to look the same everywhere. One copy per page — it is
 * rendered inside hpNav() (every generated page) or injectLangControl() (support pages).
 *
 * The count is fetched once per session from the public GitHub API and cached in sessionStorage; if
 * the request fails, the label stays "Star". No file data is involved — this is the only outbound
 * request the header makes, and it happens on the page the visitor chose to open.
 */
function ghBadge() {
  const REPO = 'pwj19960112/musepdf-core';
  return `<style>
                    .gh-star{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 11px;border-radius:999px;background:#24292f;color:#fff;font:600 13px/1 inherit;text-decoration:none;white-space:nowrap;transition:background-color .15s ease,transform .15s ease}
                    .gh-star:hover,.gh-star:focus-visible{background:#0d1117;color:#fff;transform:translateY(-1px)}
                    .gh-star:focus-visible{outline:2px solid currentColor;outline-offset:2px}
                    .gh-star-mark{width:15px;height:15px;fill:currentColor;flex:none}
                    .gh-star-count{font-variant-numeric:tabular-nums}
                </style>
                <a class="gh-star" href="https://github.com/${REPO}" target="_blank" rel="noopener noreferrer" aria-label="Star MusePDF on GitHub">
                    <svg class="gh-star-mark" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
                    <span class="gh-star-count" data-gh-stars>Star</span>
                </a>
                <script>
                (function(){var e=document.querySelectorAll('[data-gh-stars]');if(!e.length)return;var K='gh-stars:${REPO}',T=36e5;
                function f(n){return n>=1e3?(n/1e3).toFixed(1).replace(/\\.0$/,'')+'K':''+n}
                function p(n){for(var i=0;i<e.length;i++)e[i].textContent=f(n)}
                try{var c=JSON.parse(sessionStorage.getItem(K)||'null');if(c&&Date.now()-c.t<T){p(c.n);return}}catch(x){}
                fetch('https://api.github.com/repos/${REPO}',{headers:{Accept:'application/vnd.github+json'}}).then(function(r){return r.ok?r.json():null}).then(function(d){if(!d||typeof d.stargazers_count!=='number')return;p(d.stargazers_count);try{sessionStorage.setItem(K,JSON.stringify({n:d.stargazers_count,t:Date.now()}))}catch(x){}}).catch(function(){})})();
                </script>`;
}

function nav() {
  const groupLinks = GROUPS.map((g) => `<a href="/#${slugifyGroup(g)}" class="nav-link">${esc(g)}</a>`).join('\n                    ');
  return `<a href="#tool" class="skip-link">Skip to the tool</a>
    <header class="site-header">
        <nav class="container mx-auto px-4" aria-label="Main">
            <div class="header-row">
                <a href="/" class="brand" aria-label="${attr(cfg.siteName)} home">
                    <img src="/images/favicon.svg" alt="" width="32" height="32">
                    <span>${esc(cfg.siteName)}</span>
                </a>
                <div class="header-links hidden md:flex">
                    <a href="/" class="nav-link">Home</a>
                    ${groupLinks}
                </div>
                <div class="header-cta">
                    <a href="/#all-tools" class="btn-outline">Browse tools</a>
                </div>
            </div>
        </nav>
    </header>`;
}

function footer() {
  const cols = GROUPS.map((g) => `<div class="footer-col">
                    <h2 class="footer-heading">${esc(g)}</h2>
                    <ul>${groupOf(g).map((p) => `<li><a href="/${p.slug}/">${esc(p.name)}</a></li>`).join('')}</ul>
                </div>`).join('\n                ');
  return `<footer class="site-footer">
        <div class="container mx-auto px-4">
            <div class="footer-grid">
                <div class="footer-col footer-brand">
                    <a href="/" class="brand">
                        <img src="/images/favicon.svg" alt="" width="32" height="32">
                        <span>${esc(cfg.siteName)}</span>
                    </a>
                    <p>${esc(cfg.tagline)}.</p>
                    <p class="footer-legal">&copy; ${YEAR} ${esc(cfg.siteName)}.</p>
                </div>
                ${cols}
            </div>
            <div class="footer-bottom">
                <ul>
                    <li><a href="/about.html">About</a></li>
                    <li><a href="/faq.html">FAQ</a></li>
                    <li><a href="/contact.html">Contact</a></li>
                    <li><a href="/licenses.txt">Licences</a></li>
                    <li><a href="/privacy.html">Privacy</a></li>
                    <li><a href="/terms.html">Terms</a></li>
                    <li><a href="/llms.txt">llms.txt</a></li>
                </ul>
            </div>
        </div>
    </footer>`;
}

/** Hidden app scaffolding so the existing tool machinery (ui.ts / toolSelectionHandler.ts) can mount. */
/* ------------------------------------------------------------- per-tool panel markup */

/**
 * The tool panel, as STATIC markup in the page that owns it.
 *
 * A tool whose panel lives here has no entry in `src/js/ui.ts`'s `toolTemplates`, so
 * `handlers/toolSelectionHandler.ts` leaves the markup alone — which means adding a tool costs the
 * shared first-load chunk (the `landing` bundle every page downloads) exactly zero bytes, and the
 * panel's first screen is painted before any module runs. It also puts the tool's labels in the
 * pre-rendered `/zh/` page instead of inside a JS chunk the Chinese pass cannot see.
 *
 * Everything the file handler needs must be present: `#drop-zone`, `#file-input`,
 * `#file-display-area`, the `[id$="-options"]` container it un-hides, and `#process-btn`.
 */

/** The upload zone — the same ids and classes as createFileInputHTML() in src/js/ui.ts. */
function uploadZone({ multiple = false, accept = 'application/pdf', hint = 'A single PDF file' } = {}) {
  return `<div id="drop-zone" class="relative flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-gray-600 rounded-xl bg-gray-900 hover:bg-gray-700 transition-colors duration-300">
            <input id="file-input" type="file" class="hp-visually-hidden"${multiple ? ' multiple' : ''} accept="${attr(accept)}">
            <label for="file-input" class="flex flex-col items-center justify-center w-full h-full pt-5 pb-6 cursor-pointer">
                <i data-lucide="upload-cloud" class="w-10 h-10 mb-3 text-gray-400"></i>
                <p class="mb-2 text-sm text-gray-400"><span class="font-semibold">${esc(c('Click to select a file'))}</span> ${esc(c('or drag and drop'))}</p>
                <p class="text-xs text-gray-500">${esc(c(hint))}</p>
                <p class="text-xs text-gray-500">${esc(c('Your files stay on your device for this tool.'))}</p>
            </label>
        </div>
        <div id="file-display-area" class="mt-4 space-y-2"></div>`;
}

const TOOL_UI = {
  'pdf-to-text': (p) => `
        <h2 class="text-2xl font-bold text-white mb-4">${esc(reg(p.name, zp(p).name))}</h2>
        <p class="mb-6 text-gray-400">${esc(c('Extract the text layer of a PDF into a plain .txt file — page by page, on your device.'))}</p>
        ${uploadZone({ accept: '.pdf' })}
        <div id="pdf-to-text-options" class="hidden">
            <label for="pdf-to-text-markers" class="mt-4 flex items-start gap-3 cursor-pointer">
                <input type="checkbox" id="pdf-to-text-markers" class="mt-1 w-4 h-4 rounded text-indigo-600 bg-gray-700 border-gray-600">
                <span class="text-sm text-gray-300">${esc(c('Mark where each page starts (Page 1, Page 2…) in the text file'))}</span>
            </label>
            <div id="pdf-to-text-notice" class="hidden mt-4 p-3 bg-gray-900 border border-yellow-500/30 text-yellow-200 rounded-lg" role="status">
                <p class="text-sm text-gray-300"><b><span data-empty-pages data-i18n-skip>0</span> ${esc(c('page(s) have no text layer.'))}</b> ${esc(c('Those pages are images, so there is no text to copy from them.'))}</p>
                <p class="text-sm mt-1"><a class="underline" href="/ocr-pdf/">${esc(c('Run OCR PDF first'))}</a></p>
            </div>
            <button id="process-btn" class="btn-gradient w-full mt-6">${esc(c('Extract text (.txt)'))}</button>
        </div>`,
  'extract-images': (p) => `
        <h2 class="text-2xl font-bold text-white mb-4">${esc(reg(p.name, zp(p).name))}</h2>
        <p class="mb-6 text-gray-400">${esc(c('Pull every embedded image out of a PDF as PNG or JPG, packaged in one ZIP.'))}</p>
        ${uploadZone({ accept: '.pdf' })}
        <div id="extract-images-options" class="hidden">
            <label for="extract-images-format" class="mt-4 block text-sm font-medium text-gray-300">${esc(c('Image format'))}</label>
            <select id="extract-images-format" class="mt-1 w-full bg-gray-700 border border-gray-600 text-white rounded-lg p-2.5">
                <option value="png">${esc(c('PNG — lossless, keeps transparency'))}</option>
                <option value="jpeg">${esc(c('JPG — smaller files for photos'))}</option>
            </select>
            <div class="mt-4 p-3 bg-gray-900 rounded-lg border border-gray-700">
                <p class="text-xs text-gray-400">${esc(c('Text, tables and vector drawings are not images, so they are not extracted. Images under 16 pixels are skipped as decoration.'))}</p>
            </div>
            <div id="extract-images-notice" class="hidden mt-4 p-3 bg-gray-900 border border-indigo-500/30 rounded-lg" role="status">
                <p class="text-sm text-gray-300" data-image-summary></p>
                <p class="hidden text-sm mt-1 text-yellow-200" data-image-limit></p>
            </div>
            <button id="process-btn" class="btn-gradient w-full mt-6">${esc(c('Extract images (.zip)'))}</button>
        </div>`,
  'edit-bookmarks': (p) => `
        <h2 class="text-2xl font-bold text-white mb-4">${esc(reg(p.name, zp(p).name))}</h2>
        <p class="mb-6 text-gray-400">${esc(c('Rename, delete or add the entries in a PDF outline, so a long document opens on the right chapter.'))}</p>
        ${uploadZone({ accept: '.pdf' })}
        <div id="bookmarks-options" class="hidden">
            <p id="bookmark-note" class="mt-4 text-sm text-gray-400">${esc(c('Add the PDF to load its bookmarks.'))}</p>
            <div class="mt-3 flex items-center gap-2 text-xs uppercase tracking-wide text-gray-500">
                <span class="flex-1">${esc(c('Title'))}</span>
                <span class="w-20">${esc(c('Page'))}</span>
                <span class="w-8"></span>
            </div>
            <div id="bookmark-rows" class="mt-2 space-y-2"></div>
            <p id="bookmark-empty" class="hidden mt-2 text-sm text-gray-500">${esc(c('No bookmarks yet — add the first one below.'))}</p>
            <button id="bookmark-add" type="button" class="mt-3 w-full btn bg-gray-800 border border-gray-600 text-gray-200 font-semibold py-2 rounded-lg hover:bg-gray-700">
                <span>${esc(c('Add bookmark'))}</span>
                <span class="ml-1 text-gray-400" data-i18n-skip>(<span id="bookmark-count">0</span>)</span>
            </button>
            <button id="process-btn" class="btn-gradient w-full mt-3">${esc(c('Save bookmarks'))}</button>
        </div>`,
  'bates-numbering': (p) => `
        <h2 class="text-2xl font-bold text-white mb-4">${esc(reg(p.name, zp(p).name))}</h2>
        <p class="mb-6 text-gray-400">${esc(c('Stamp a prefix and a running counter on every page. Add several files and the number keeps counting across them.'))}</p>
        ${uploadZone({ multiple: true, accept: '.pdf', hint: 'One or more PDF files' })}
        <div class="hidden mt-4 flex gap-3" id="file-controls">
            <button id="add-more-btn" type="button" class="btn bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-4 py-2 rounded-lg">${esc(c('Add more files'))}</button>
            <button id="clear-files-btn" type="button" class="btn bg-red-600 hover:bg-red-700 text-white font-semibold px-4 py-2 rounded-lg">${esc(c('Clear all'))}</button>
        </div>
        <div id="bates-numbering-options" class="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
                <label for="bates-prefix" class="block mb-2 text-sm font-medium text-gray-300">${esc(c('Prefix'))}</label>
                <input id="bates-prefix" type="text" value="ABC" class="w-full bg-gray-700 border border-gray-600 text-white rounded-lg p-2.5">
            </div>
            <div>
                <label for="bates-start" class="block mb-2 text-sm font-medium text-gray-300">${esc(c('Start number'))}</label>
                <input id="bates-start" type="number" min="0" step="1" value="1" class="w-full bg-gray-700 border border-gray-600 text-white rounded-lg p-2.5">
            </div>
            <div>
                <label for="bates-digits" class="block mb-2 text-sm font-medium text-gray-300">${esc(c('Digits (zero padded)'))}</label>
                <input id="bates-digits" type="number" min="1" max="12" step="1" value="6" class="w-full bg-gray-700 border border-gray-600 text-white rounded-lg p-2.5">
            </div>
            <div>
                <label for="bates-size" class="block mb-2 text-sm font-medium text-gray-300">${esc(c('Font size'))}</label>
                <input id="bates-size" type="number" min="4" max="48" step="1" value="10" class="w-full bg-gray-700 border border-gray-600 text-white rounded-lg p-2.5">
            </div>
            <div class="md:col-span-2">
                <label for="bates-position" class="block mb-2 text-sm font-medium text-gray-300">${esc(c('Position on the page'))}</label>
                <select id="bates-position" class="w-full bg-gray-700 border border-gray-600 text-white rounded-lg p-2.5">
                    <option value="bottom-right">${esc(c('Bottom right'))}</option>
                    <option value="bottom-left">${esc(c('Bottom left'))}</option>
                    <option value="bottom-center">${esc(c('Bottom centre'))}</option>
                    <option value="top-right">${esc(c('Top right'))}</option>
                    <option value="top-left">${esc(c('Top left'))}</option>
                    <option value="top-center">${esc(c('Top centre'))}</option>
                </select>
            </div>
            <p class="md:col-span-2 text-xs text-gray-500">${esc(c('The number keeps counting across every file in one run, in the order they were added.'))}</p>
            <button id="process-btn" class="btn-gradient w-full mt-2 md:col-span-2" disabled>${esc(c('Stamp Bates numbers'))}</button>
        </div>`,
  'pdf-to-csv': (p) => `
        <h2 class="text-2xl font-bold text-white mb-4">${esc(reg(p.name, zp(p).name))}</h2>
        <p class="mb-6 text-gray-400">${esc(c('Rebuild the tables in a PDF as CSV — one file per page that has a table, on your device.'))}</p>
        ${uploadZone({ accept: '.pdf' })}
        <div id="pdf-to-csv-options" class="hidden">
            <div class="mt-4 p-3 bg-gray-900 rounded-lg border border-gray-700">
                <p class="text-xs text-gray-400">${esc(c('Columns come from the gaps between the text runs on a page. A scanned page has no text layer, so it has no table to rebuild.'))}</p>
            </div>
            <p class="mt-4 text-sm text-gray-300" data-table-summary></p>
            <button id="process-btn" class="btn-gradient w-full mt-4">${esc(c('Download the tables (CSV)'))}</button>
        </div>`,
  'pdf-to-excel': (p) => `
        <h2 class="text-2xl font-bold text-white mb-4">${esc(reg(p.name, zp(p).name))}</h2>
        <p class="mb-6 text-gray-400">${esc(c('Turn the tables in a PDF into a real Excel workbook — one worksheet per page, built in your browser.'))}</p>
        ${uploadZone({ accept: '.pdf' })}
        <div id="pdf-to-excel-options" class="hidden">
            <div class="mt-4 p-3 bg-gray-900 rounded-lg border border-gray-700">
                <p class="text-xs text-gray-400">${esc(c('Numbers are written as numbers so you can sum them; labels with a thousands separator or a leading zero stay text, exactly as printed.'))}</p>
            </div>
            <p class="mt-4 text-sm text-gray-300" data-table-summary></p>
            <button id="process-btn" class="btn-gradient w-full mt-4">${esc(c('Download the workbook (.xlsx)'))}</button>
        </div>`,
  'pdf-table-of-contents': (p) => `
        <h2 class="text-2xl font-bold text-white mb-4">${esc(reg(p.name, zp(p).name))}</h2>
        <p class="mb-6 text-gray-400">${esc(c('Build a contents page from the bookmarks this PDF already has — with dot leaders, page numbers and clickable rows.'))}</p>
        ${uploadZone({ accept: '.pdf' })}
        <div id="table-of-contents-options" class="hidden">
            <label for="toc-title" class="mt-4 block mb-2 text-sm font-medium text-gray-300">${esc(c('Heading'))}</label>
            <input id="toc-title" type="text" value="Table of Contents" class="w-full bg-gray-700 border border-gray-600 text-white rounded-lg p-2.5">
            <label for="toc-position" class="mt-4 block mb-2 text-sm font-medium text-gray-300">${esc(c('Where to put it'))}</label>
            <select id="toc-position" class="w-full bg-gray-700 border border-gray-600 text-white rounded-lg p-2.5">
                <option value="front">${esc(c('At the front of the document'))}</option>
                <option value="after-cover">${esc(c('After the first page (a cover)'))}</option>
            </select>
            <label for="toc-links" class="mt-4 flex items-start gap-3 cursor-pointer">
                <input type="checkbox" id="toc-links" class="mt-1 w-4 h-4 rounded text-indigo-600 bg-gray-700 border-gray-600" checked>
                <span class="text-sm text-gray-300">${esc(c('Make every row a link that jumps to its page'))}</span>
            </label>
            <div class="mt-4 p-3 bg-gray-900 rounded-lg border border-gray-700">
                <p class="text-xs text-gray-400">${esc(c('A long outline continues onto a second contents page. A PDF with no bookmarks cannot produce one — add entries with Edit Bookmarks first.'))}</p>
                <p class="text-xs mt-1"><a class="underline" href="/edit-bookmarks/">${esc(c('Edit Bookmarks'))}</a></p>
            </div>
            <p class="mt-4 text-sm text-gray-300" data-toc-summary></p>
            <button id="process-btn" class="btn-gradient w-full mt-4">${esc(c('Add the contents page (PDF)'))}</button>
        </div>`,
  'add-page-labels': (p) => `
        <h2 class="text-2xl font-bold text-white mb-4">${esc(reg(p.name, zp(p).name))}</h2>
        <p class="mb-6 text-gray-400">${esc(c('Set the page labels a reader shows — i, ii, iii or 1, 2, 3 — without printing anything onto the pages.'))}</p>
        ${uploadZone({ accept: '.pdf' })}
        <div id="add-page-labels-options" class="hidden">
            <label for="labels-style" class="mt-4 block mb-2 text-sm font-medium text-gray-300">${esc(c('Numbering style'))}</label>
            <select id="labels-style" class="w-full bg-gray-700 border border-gray-600 text-white rounded-lg p-2.5">
                <option value="D">${esc(c('Decimal — 1, 2, 3'))}</option>
                <option value="R">${esc(c('Roman upper — I, II, III'))}</option>
                <option value="r">${esc(c('Roman lower — i, ii, iii'))}</option>
                <option value="A">${esc(c('Letters upper — A, B, C'))}</option>
                <option value="a">${esc(c('Letters lower — a, b, c'))}</option>
            </select>
            <div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label for="labels-prefix" class="block mb-2 text-sm font-medium text-gray-300">${esc(c('Prefix'))}</label>
                    <input id="labels-prefix" type="text" placeholder="${attr(a('e.g. Report-'))}" class="w-full bg-gray-700 border border-gray-600 text-white rounded-lg p-2.5">
                </div>
                <div>
                    <label for="labels-start" class="block mb-2 text-sm font-medium text-gray-300">${esc(c('Start number'))}</label>
                    <input id="labels-start" type="number" min="1" step="1" value="1" class="w-full bg-gray-700 border border-gray-600 text-white rounded-lg p-2.5">
                </div>
                <div class="md:col-span-2">
                    <label for="labels-front" class="block mb-2 text-sm font-medium text-gray-300">${esc(c('Front matter pages in roman (i, ii, iii…)'))}</label>
                    <input id="labels-front" type="number" min="0" step="1" value="0" class="w-full bg-gray-700 border border-gray-600 text-white rounded-lg p-2.5">
                </div>
            </div>
            <div class="mt-4 p-3 bg-gray-900 rounded-lg border border-gray-700">
                <p class="text-xs text-gray-400">${esc(c('Page labels are metadata: no page is added, removed or redrawn.'))}</p>
            </div>
            <p class="mt-4 text-sm text-gray-300" data-labels-summary></p>
            <button id="process-btn" class="btn-gradient w-full mt-4">${esc(c('Save page labels (PDF)'))}</button>
        </div>`,
  'split-pdf-by-bookmarks': (p) => `
        <h2 class="text-2xl font-bold text-white mb-4">${esc(reg(p.name, zp(p).name))}</h2>
        <p class="mb-6 text-gray-400">${esc(c('Every top-level bookmark becomes its own PDF, named from the chapter title. Front matter joins the first part and everything after the last bookmark stays with the final part.'))}</p>
        ${uploadZone({ accept: '.pdf' })}
        <div id="split-pdf-by-bookmarks-options" class="hidden">
            <p id="split-bookmarks-note" class="mt-4 text-sm text-gray-400"></p>
            <ul id="split-bookmarks-list" class="mt-4 text-sm text-gray-300"></ul>
            <p id="split-bookmarks-result" class="mt-4 text-sm text-gray-300" role="status"></p>
            <button id="process-btn" class="btn-gradient w-full mt-4">${esc(c('Split at bookmarks (ZIP)'))}</button>
        </div>`,
  'pdf-booklet': (p) => `
        <h2 class="text-2xl font-bold text-white mb-4">${esc(reg(p.name, zp(p).name))}</h2>
        <p class="mb-6 text-gray-400">${esc(c('Fold, staple, read: pages are imposed in saddle-stitch order. Print double-sided, flip on the SHORT edge, at 100% scale — then fold the stack in half.'))}</p>
        ${uploadZone({ accept: '.pdf' })}
        <div id="pdf-booklet-options" class="hidden">
            <label for="booklet-signature" class="mt-4 block mb-2 text-sm font-medium text-gray-300">${esc(c('Pages per booklet'))}</label>
            <select id="booklet-signature" class="w-full bg-gray-700 border border-gray-600 text-white rounded-lg p-2.5">
                <option value="16" selected>${esc(c('16 pages (recommended)'))}</option>
                <option value="8">${esc(c('8 pages'))}</option>
                <option value="4">${esc(c('4 pages'))}</option>
                <option value="0">${esc(c('Everything in one booklet'))}</option>
            </select>
            <label for="booklet-paper" class="mt-4 block mb-2 text-sm font-medium text-gray-300">${esc(c('Sheet size'))}</label>
            <select id="booklet-paper" class="w-full bg-gray-700 border border-gray-600 text-white rounded-lg p-2.5">
                <option value="a4" selected>A4 landscape</option>
                <option value="letter">Letter landscape</option>
                <option value="a3">A3 landscape</option>
            </select>
            <label for="booklet-scale" class="mt-4 block mb-2 text-sm font-medium text-gray-300">${esc(c('Page scaling'))}</label>
            <select id="booklet-scale" class="w-full bg-gray-700 border border-gray-600 text-white rounded-lg p-2.5">
                <option value="fit" selected>${esc(c('Scale to fit the half sheet'))}</option>
                <option value="none">${esc(c('Keep original size'))}</option>
            </select>
            <details class="mt-4">
                <summary class="cursor-pointer text-sm text-gray-400">${esc(c('Advanced'))}</summary>
                <label for="booklet-creep" class="mt-3 block mb-2 text-sm font-medium text-gray-300">${esc(c('Binding creep (mm)'))}</label>
                <input id="booklet-creep" type="number" min="0" max="20" step="0.5" value="0" class="w-full bg-gray-700 border border-gray-600 text-white rounded-lg p-2.5">
                <p class="mt-2 text-xs text-gray-400">${esc(c('Thicker booklets need the inner pages shifted outward slightly. Leave 0 for thin booklets.'))}</p>
            </details>
            <div id="booklet-preview" class="mt-4 p-3 bg-gray-900 rounded-lg border border-gray-700 text-sm text-gray-300"></div>
            <p id="booklet-result" class="mt-4 text-sm text-gray-300" role="status"></p>
            <button id="process-btn" class="btn-gradient w-full mt-4">${esc(c('Build the booklet'))}</button>
        </div>`,
  'add-attachments': (p) => `
        <h2 class="text-2xl font-bold text-white mb-4">${esc(reg(p.name, zp(p).name))}</h2>
        <p class="mb-6 text-gray-400">${esc(c('Add the PDF first, then the files that should travel with it: they are embedded inside the document and listed in any reader\'s attachment panel.'))}</p>
        ${uploadZone({ accept: '.pdf' })}
        <div id="add-attachments-options" class="hidden">
            <p id="attachments-existing" class="mt-4 text-sm text-gray-400"></p>
            <label for="attachment-input" class="mt-4 block mb-2 text-sm font-medium text-gray-300">${esc(c('Files to attach'))}</label>
            <input id="attachment-input" type="file" multiple class="w-full text-sm text-gray-300 bg-gray-700 border border-gray-600 rounded-lg p-2.5">
            <p id="attachment-selected" class="mt-2 text-sm text-gray-400"></p>
            <ul id="attachment-list" class="mt-2 text-sm text-gray-300"></ul>
            <p id="attachments-result" class="mt-4 text-sm text-gray-300" role="status"></p>
            <button id="process-btn" class="btn-gradient w-full mt-4">${esc(c('Add attachments (PDF)'))}</button>
        </div>`,
  'overlay-pdf': (p) => `
        <h2 class="text-2xl font-bold text-white mb-4">${esc(reg(p.name, zp(p).name))}</h2>
        <p class="mb-6 text-gray-400">${esc(c('Add the base PDF first, then the layer: the second document lands on top of (overlay) or behind (underlay) every page, and repeats its last page when it is shorter.'))}</p>
        ${uploadZone({ accept: '.pdf', multiple: true })}
        <div id="overlay-pdf-options" class="hidden">
            <p id="overlay-note" class="mt-4 text-sm text-gray-400"></p>
            <label for="overlay-mode" class="mt-4 block mb-2 text-sm font-medium text-gray-300">${esc(c('Where does the second file go?'))}</label>
            <select id="overlay-mode" class="w-full bg-gray-700 border border-gray-600 text-white rounded-lg p-2.5">
                <option value="top">${esc(c('On top — stamps and watermarks'))}</option>
                <option value="bottom">${esc(c('Underneath — letterheads and pre-printed forms'))}</option>
            </select>
            <label for="overlay-opacity" class="mt-4 block mb-2 text-sm font-medium text-gray-300">${esc(c('Opacity (%)'))}</label>
            <input id="overlay-opacity" type="number" min="5" max="100" step="5" value="100" class="w-full bg-gray-700 border border-gray-600 text-white rounded-lg p-2.5">
            <label class="mt-4 flex items-center gap-2 text-sm text-gray-300"><input id="overlay-repeat" type="checkbox" checked class="rounded bg-gray-700 border-gray-600"> ${esc(c('Repeat the last page when the layer is shorter'))}</label>
            <p id="overlay-result" class="mt-4 text-sm text-gray-300" role="status"></p>
            <button id="process-btn" class="btn-gradient w-full mt-4">${esc(c('Overlay PDFs'))}</button>
        </div>`,
  'split-pdf-by-size': (p) => `
        <h2 class="text-2xl font-bold text-white mb-4">${esc(reg(p.name, zp(p).name))}</h2>
        <p class="mb-6 text-gray-400">${esc(c('Enter the limit your email, portal or upload form enforces: the document is cut into parts that each come in under it, and every part is measured as a real PDF.'))}</p>
        ${uploadZone({ accept: '.pdf' })}
        <div id="split-pdf-by-size-options" class="hidden">
            <p id="split-size-note" class="mt-4 text-sm text-gray-400"></p>
            <label for="split-size-target" class="mt-4 block mb-2 text-sm font-medium text-gray-300">${esc(c('Largest part (MB)'))}</label>
            <input id="split-size-target" type="number" min="0.1" max="4000" step="0.1" value="10" class="w-full bg-gray-700 border border-gray-600 text-white rounded-lg p-2.5">
            <div class="mt-4 p-3 bg-gray-900 rounded-lg border border-gray-700">
                <p class="text-xs text-gray-400">${esc(c('Parts are measured by writing them out, so the size you see is the size of the file you download — not an estimate from page counts. A single image-heavy page that is larger than the limit is saved on its own and reported: no split can shrink one page, so compress the PDF first if the limit is strict.'))}</p>
            </div>
            <p id="split-size-result" class="mt-4 text-sm text-gray-300" role="status"></p>
            <button id="process-btn" class="btn-gradient w-full mt-4">${esc(c('Split by size (ZIP)'))}</button>
        </div>`,
};

const toolPanel = (p) => (TOOL_UI[p.slug] ? TOOL_UI[p.slug](p) : '');

function appShell({ toolId, idPrefix = '', inner = '' }) {
  return `<div id="${idPrefix}grid-view" class="hidden" aria-hidden="true"><div id="${idPrefix}tool-grid"></div></div>
    <div id="${idPrefix}hero-section" class="hidden" aria-hidden="true"></div>
    <div id="${idPrefix}features-section" class="hidden" aria-hidden="true"></div>
    <div id="${idPrefix}tools-header" class="hidden" aria-hidden="true"></div>
    <button id="${idPrefix}back-to-grid" class="hidden" aria-hidden="true"></button>

    <div id="tool-interface" class="tool-panel">
        <div id="tool-content">${inner}</div>
    </div>

    <div id="loader-modal" class="hidden fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
        <div class="bg-gray-800 p-8 rounded-lg flex flex-col items-center gap-4 border border-gray-700 shadow-xl">
            <div class="solid-spinner"></div>
            <p id="loader-text" class="text-white text-lg font-medium">Processing...</p>
        </div>
    </div>

    <div id="alert-modal" class="hidden fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
        <div class="bg-gray-800 max-w-sm w-full p-6 rounded-lg border border-gray-700 shadow-xl text-center">
            <h3 id="alert-title" class="text-xl font-bold text-white mb-2">Alert</h3>
            <p id="alert-message" class="text-gray-300 mb-6">This is an alert message.</p>
            <button id="alert-ok" class="btn bg-indigo-600 text-white font-semibold py-2 px-6 rounded-lg hover:bg-indigo-700">OK</button>
        </div>
    </div>

    <div id="preview-modal" class="hidden fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-40 p-4">
        <div class="bg-white text-black rounded-lg shadow-xl w-full max-w-4xl h-[90vh] flex flex-col">
            <div class="p-4 border-b flex justify-between items-center">
                <h3 class="text-xl font-bold">Document Preview</h3>
                <div class="flex gap-4">
                    <button id="preview-download-btn" class="btn bg-indigo-600 text-white font-semibold py-2 px-6 rounded-lg hover:bg-indigo-700">Download as PDF</button>
                    <button id="preview-close-btn" class="btn bg-gray-600 text-white font-semibold py-2 px-6 rounded-lg hover:bg-gray-700">Close</button>
                </div>
            </div>
            <div id="preview-content" class="p-8 overflow-y-auto flex-grow"></div>
        </div>
    </div>

    <div id="signature-ghost" class="hidden"></div>
    <div data-app-shell-for="${attr(toolId)}" hidden></div>`;
}

const AUTH = `<script type="module" src="/src/js/landing.ts"></script>`;

function faqMarkup(list) {
  return list.map((f, i) => `<details class="faq-item"${i === 0 ? ' open' : ''}>
                <summary>${esc(f.q)}</summary>
                <div class="faq-answer"><p>${esc(f.a)}</p></div>
            </details>`).join('\n            ');
}

function relatedMarkup(p) {
  const sameGroup = groupOf(p.group).filter((x) => x.slug !== p.slug);
  const picks = [...sameGroup.slice(0, 4), ...pages.filter((x) => x.group !== p.group).slice(0, 2)];
  return picks.map((r) => `<a class="card-link" href="/${r.slug}/">
                    <span class="card-link-title">${esc(r.name)}</span>
                    <span class="card-link-desc">${esc(r.subtitle || r.detail)}</span>
                </a>`).join('\n                ');
}

function toolCard(p) {
  return `<a class="tool-card" href="/${p.slug}/" data-tool-id="${attr(p.id)}">
                    <span class="tool-card-name">${esc(p.name)}</span>
                    <span class="tool-card-desc">${esc(p.subtitle || p.detail)}</span>
                </a>`;
}

function slugifyGroup(g) {
  return g.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/* ------------------------------------------------------------- tool landing page */

function toolPage(p) {
  const canonical = url(p.slug);
  const faqs = faqsFor(p);
  const steps = stepsFor(p);
  const groupIcon = GROUP_ICON[p.group] || 'doc';
  const v = varsFor(p);
  const z = zp(p);
  const zhFeatures = Array.isArray(z.features) ? z.features : [];
  const zhSteps = Array.isArray(z.steps) ? z.steps : [];
  const features = p.features.length ? p.features : [p.detail, 'Runs offline once loaded', 'Works on desktop, tablet and phone'];
  const h1Zh = z.h1 ?? ZHP.tools?.[p.slug]?.h1 ?? zfill(ZH.templates?.toolH1, v, p.h1);
  const leadEn = fill('{detail} Add your {in} and get {out} — no upload, no signup, no watermark.', v);
  const leadZh = z.lead ?? zfill(ZH.templates?.toolLead, v, leadEn);
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' },
        { '@type': 'ListItem', position: 2, name: p.group, item: `${SITE}/#${slugifyGroup(p.group)}` },
        { '@type': 'ListItem', position: 3, name: p.name, item: canonical },
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: `${p.name} — ${cfg.siteName}`,
      url: canonical,
      applicationCategory: 'UtilitiesApplication',
      operatingSystem: 'Any modern browser',
      browserRequirements: 'Requires JavaScript',
      isAccessibleForFree: true,
      description: p.description,
      featureList: [p.detail, ...p.features],
      // `price: 0` is scoped to THIS local tool: the local tools are free, but optional cloud features
      // are metered, so a bare station-level `price: 0` would be structured data that lies.
      offers: { '@type': 'Offer', name: 'Free local tool', price: '0', priceCurrency: 'USD', description: 'This tool runs in your browser and is free; optional cloud features are metered.' },
      publisher: { '@type': 'Organization', name: cfg.organization.name, url: SITE },
      keywords: [p.kw, ...p.secondary].join(', '),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'HowTo',
      name: `How to ${p.kw}`,
      totalTime: 'PT1M',
      tool: [{ '@type': 'HowToTool', name: `${cfg.siteName} ${p.name}` }],
      step: steps.map((s, i) => ({ '@type': 'HowToStep', position: i + 1, name: s[0], text: s[1] || s[0] })),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
    },
  ];

  const related = (() => {
    const sameGroup = groupOf(p.group).filter((x) => x.slug !== p.slug);
    return [...sameGroup.slice(0, 4), ...pages.filter((x) => x.group !== p.group).slice(0, 2)];
  })();

  return `<!DOCTYPE html>
<html lang="en" data-page-lang="en">
<head>
    ${head({
    title: p.title,
    description: p.description,
    canonical,
    jsonLd,
    alternates: { ...altsFor(p.slug), xDefault: canonical },
    css: ['/src/css/styles.css', '/src/css/theme.css'],
  })}
</head>
<body class="hp" data-tool="${attr(p.id)}" data-tool-group="${attr(p.group)}">
    ${hpNav(langPathsFor(p.slug))}
    <main id="tool">
        <div class="hp-container">
            <nav class="hp-breadcrumb" aria-label="Breadcrumb">
                <ol>
                    <li><a href="/">${esc(c('Home'))}</a></li>
                    <li><a href="/#${slugifyGroup(p.group)}">${esc(c(p.group))}</a></li>
                    <li aria-current="page">${esc(reg(p.name, z.name))}</li>
                </ol>
            </nav>

            <div class="hp-tool-hero">
                ${hpIcon(groupIcon, 'hp-tool-icon')}
                <div>
                    <h1>${esc(reg(p.h1, h1Zh))}</h1>
                    <p class="hp-lead">${esc(reg(leadEn, leadZh))}</p>
                </div>
            </div>

            <div class="hp-tool-shell">
                <div class="hp-app">
                    ${appShell({ toolId: p.id, inner: toolPanel(p) })}
                </div>
            </div>

            <section class="hp-section">
                <h2>${esc(tpl('What you can do with {name}', ZH.templates?.whatCanDo, v))}</h2>
                <div class="hp-cols">
                    ${features
    .map((f, i) => `<div class="hp-info">${hpIcon('check')}<p>${esc(reg(f, zhFeatures[i]))}</p></div>`).join('\n                    ')}
                </div>
            </section>

            ${(p.sections || []).map((s) => `\n            <section class="hp-section">\n                <h2>${esc(c(s.h2))}</h2>\n                ${(s.p || []).map((para) => `<p class="hp-section-lead">${esc(c(para))}</p>`).join(' ')}\n            </section>`).join('')}

            <section class="hp-section">
                <h2>${esc(tpl('How to {kw} in 3 steps', ZH.templates?.howTo, v))}</h2>
                <ol class="hp-steps">
                    ${steps.map((s, i) => `<li><h3>${esc(reg(s[0], zhSteps[i]?.[0]))}</h3><p>${esc(reg(s[1] || '', zhSteps[i]?.[1]))}</p></li>`).join('\n                    ')}
                </ol>
                <p class="hp-section-lead" style="margin-top:24px">${esc(tpl((GROUP_NOTE_OVERRIDE[p.slug] || GROUP_NOTE[p.group])(p), ZH.groupNotes?.[p.slug] ?? ZH.groupNotes?.[p.group], v))}</p>
                ${p.seeAlso ? `<p class="hp-section-lead" style="margin-top:12px"><a href="${attr(p.seeAlso.href)}">${esc(reg(p.seeAlso.text, zp(p).seeAlso?.text))}</a></p>` : ''}
            </section>
        </div>

        <section class="hp-band">
            <div class="hp-container hp-band-inner">
                <div class="hp-cols">
                    <div class="hp-info" style="border:0">
                        ${hpIcon('shield')}
                        <h3>${esc(c('No upload'))}</h3>
                        <p>${esc(tpl('Your {in} are read locally with JavaScript and WebAssembly — for this tool, nothing is sent to a server.', ZH.templates?.bandPrivacy, v))}</p>
                    </div>
                    <div class="hp-info" style="border:0">
                        ${hpIcon('spark')}
                        <h3>${esc(c('No signup'))}</h3>
                        <p>${esc(c('No account, no email, no credit card, no trial to remember.'))}</p>
                    </div>
                    <div class="hp-info" style="border:0">
                        ${hpIcon('check')}
                        <h3>${esc(c('No watermark'))}</h3>
                        <p>${esc(c('What you download is the real file — clean, unmarked and print-ready.'))}</p>
                    </div>
                </div>
            </div>
        </section>

        <div class="hp-container">
            <section class="hp-section">
                <h2>${esc(tpl('{name} FAQ', ZH.templates?.toolFaq, v))}</h2>
                <div class="hp-faq">
                    ${faqs.map((f, i) => `<details${i === 0 ? ' open' : ''}>
                        <summary>${esc(reg(f.q, f.zq))}</summary>
                        <p>${esc(reg(f.a, f.za))}</p>
                    </details>`).join('\n                    ')}
                </div>
            </section>

            <section class="hp-section">
                <h2>${esc(c('Related PDF tools'))}</h2>
                <div class="hp-grid">
                    ${related.map((r) => `<a class="hp-card" href="/${r.slug}/">
                        ${hpIcon(GROUP_ICON[r.group] || 'doc')}
                        <span class="hp-card-body">
                            <span class="hp-card-name">${esc(reg(r.name, zp(r).name))}</span>
                            <span class="hp-card-desc">${esc(reg(r.subtitle || r.detail, zp(r).card))}</span>
                        </span>
                    </a>`).join('\n                    ')}
                </div>
            </section>

            <section class="hp-section">
                <h2>${esc(tpl('Every {site} tool', ZH.templates?.everyTool, PAGE_VARS))}</h2>
                <p class="hp-section-lead">${esc(c('MusePDF ships {n} browser-based PDF tools.'))} <a href="/#all-tools">${esc(c('Browse the full homepage list.'))}</a></p>
            </section>
        </div>
    </main>
    ${hpFooter()}
    ${GA_BOOT}
    <script type="module" src="/src/js/landing.ts"></script>
</body>
</html>
`;
}

/* -------------------------------------------------------------------- homepage */

/* ------------------------------------------------------------------ homepage skin */

/** Curated inline SVG set — keeps icons out of the JS bundle (no lucide on these pages). */
const HP_ICONS = {
  doc: 'M14 3v5h5M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z',
  scissors: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 4 8.1 15.9M14.5 14.5 20 20',
  plus: 'M12 5v14M5 12h14',
  image: 'M4 4h16v16H4zM4 15l4-4 5 5 3-3 4 4M14.5 8.5h.01',
  pen: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  gauge: 'M5.6 18a9 9 0 1 1 12.8 0M12 13l4-4',
  shield: 'M12 3l7 3v6c0 5-3 8-7 9-4-1-7-4-7-9V6z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  check: 'M20 6 9 17l-5-5',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  spark: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
};

const GROUP_ICON = {
  'Merge & Split': 'scissors',
  'Convert to PDF': 'plus',
  'Convert from PDF': 'image',
  'Edit & Annotate': 'pen',
  Organize: 'grid',
  Optimize: 'gauge',
  Secure: 'shield',
};

const hpIcon = (name, cls = '') =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${HP_ICONS[name] || HP_ICONS.doc}"/></svg>`;

/* ------------------------------------------------------- per-tool card icons */

/**
 * One lucide icon per tool SLUG — the action that page performs, not the group it sits in, so
 * "merge" and "split" stop sharing a scissors glyph. The names are resolved at build time against
 * `node_modules/lucide-static/icons/<name>.svg` (ISC, already a devDependency) and the SVG body is
 * inlined into the card markup: no extra request, no icon font, no JS, nothing for the first-load
 * budget. A name lucide does not ship falls back to `file-text` instead of an empty card, and the
 * run prints every fallback so a typo cannot pass silently.
 */
const TOOL_ICONS = {
  // Merge & Split
  'merge-pdf': 'merge',
  'split-pdf': 'scissors',
  'split-pdf-in-half': 'columns-2',
  'split-pdf-by-size': 'weight',
  'split-pdf-by-bookmarks': 'book-marked',
  'overlay-pdf': 'layers',
  'add-attachments': 'paperclip',
  'pdf-booklet': 'book-open',
  'extract-pages-from-pdf': 'file-output',
  'delete-pages-from-pdf': 'file-minus',
  'combine-pdf-to-single-page': 'files',
  'alternate-mix-pdf-pages': 'shuffle',
  'reverse-pdf-pages': 'arrow-down-up',
  // Convert to PDF
  'jpg-to-pdf': 'image',
  'png-to-pdf': 'image',
  'webp-to-pdf': 'image',
  'svg-to-pdf': 'shapes',
  'bmp-to-pdf': 'image',
  'heic-to-pdf': 'image',
  'tiff-to-pdf': 'image',
  'txt-to-pdf': 'file-text',
  'image-to-pdf': 'images',
  'word-to-pdf': 'file-text',
  'markdown-to-pdf': 'file-code',
  'scan-to-pdf': 'scan',
  // Convert from PDF
  'pdf-to-jpg': 'file-image',
  'pdf-to-png': 'file-image',
  'pdf-to-webp': 'file-image',
  'pdf-to-bmp': 'file-image',
  'pdf-to-tiff': 'file-image',
  'pdf-to-zip': 'file-archive',
  'pdf-to-markdown': 'file-code',
  'pdf-to-grayscale': 'droplet',
  'pdf-to-word': 'file-text',
  'pdf-to-text': 'file-type',
  'pdf-to-csv': 'table',
  'pdf-to-excel': 'file-spreadsheet',
  'extract-images': 'images',
  'edit-bookmarks': 'book-marked',
  'bates-numbering': 'binary',
  // Edit & Annotate
  'edit-pdf': 'square-pen',
  'edit-text-in-pdf': 'type',
  'sign-pdf': 'pen-tool',
  'fill-pdf-form': 'text-cursor-input',
  'add-watermark-to-pdf': 'stamp',
  'add-page-numbers-to-pdf': 'hash',
  'pdf-table-of-contents': 'table-of-contents',
  'add-page-labels-to-pdf': 'tag',
  'add-header-footer-to-pdf': 'panel-top',
  'change-pdf-text-color': 'palette',
  'change-pdf-background-color': 'paint-bucket',
  'invert-pdf-colors': 'contrast',
  'crop-pdf': 'crop',
  'rotate-pdf': 'rotate-cw',
  'remove-pdf-annotations': 'eraser',
  'annotate-pdf': 'highlighter',
  'stamp-pdf': 'stamp',
  // Organize
  'add-blank-page-to-pdf': 'file-plus',
  'organize-pdf': 'layout-grid',
  'duplicate-pdf-pages': 'copy',
  'n-up-pdf': 'grid-2x2',
  'posterize-pdf': 'grid-3x3',
  'compare-pdf-files': 'git-compare',
  'fix-pdf-page-size': 'scaling',
  // Optimize
  'compress-pdf': 'minimize-2',
  'pdf-page-dimensions': 'ruler',
  'remove-blank-pages-from-pdf': 'file-x',
  'ocr-pdf': 'scan-text',
  'flatten-pdf': 'layers',
  'remove-pdf-metadata': 'trash-2',
  'edit-pdf-metadata': 'info',
  'view-pdf-metadata': 'eye',
  // Secure
  'protect-pdf': 'lock',
  'unlock-pdf': 'lock-open',
  'change-pdf-permissions': 'key-round',
};

const LUCIDE_DIR = path.join(ROOT, 'node_modules', 'lucide-static', 'icons');
const ICON_FALLBACK = 'file-text';
const ICON_CACHE = new Map();
const ICON_MISSES = [];

/**
 * Inline one lucide SVG. The published file carries a `@license` comment and an `xml` prolog that
 * cannot sit inside a document, plus `width`/`height` 24 which the card CSS overrides — so the
 * wrapper tag is rebuilt from the file's own `viewBox` and only the children are kept.
 */
function lucideSvg(name, cls = 'hp-card-icon') {
  const key = `${name}|${cls}`;
  if (ICON_CACHE.has(key)) return ICON_CACHE.get(key);
  const file = path.join(LUCIDE_DIR, `${name}.svg`);
  if (!fs.existsSync(file)) {
    if (!ICON_MISSES.includes(name)) ICON_MISSES.push(name);
    const fallback = name === ICON_FALLBACK ? '' : lucideSvg(ICON_FALLBACK, cls);
    ICON_CACHE.set(key, fallback);
    return fallback;
  }
  const raw = fs.readFileSync(file, 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')      // the @license banner
    .replace(/<\?xml[\s\S]*?\?>/g, '');   // the prolog
  const open = /<svg\b[^>]*>/.exec(raw);
  const close = raw.lastIndexOf('</svg>');
  if (!open || close === -1) {
    if (!ICON_MISSES.includes(name)) ICON_MISSES.push(name);
    ICON_CACHE.set(key, '');
    return '';
  }
  const viewBox = /viewBox="([^"]+)"/.exec(open[0])?.[1] || '0 0 24 24';
  const body = raw.slice(open.index + open[0].length, close).replace(/\s+/g, ' ').trim();
  const markup = `<svg class="${cls}" width="22" height="22" viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  ICON_CACHE.set(key, markup);
  return markup;
}

/** The card icon for one page: its own lucide glyph, or the documented fallback. */
const toolIcon = (slug) => lucideSvg(TOOL_ICONS[slug] || ICON_FALLBACK);

/** Counted for the build log: names lucide actually shipped vs slugs that fell back. */
function iconReport() {
  const missing = pages.filter((p) => !fs.existsSync(path.join(LUCIDE_DIR, `${TOOL_ICONS[p.slug] || ICON_FALLBACK}.svg`)));
  const unmapped = pages.filter((p) => !TOOL_ICONS[p.slug]);
  return { total: pages.length, verified: pages.length - missing.length, fallback: missing, unmapped };
}

/* -------------------------------------------------------------------- sponsor */

/**
 * The sponsor slot: a mailto-only panel — no form, no script, no tracker. One address for the whole
 * block so a click anywhere in it opens the same message.
 */
const SPONSOR_MAILTO = 'mailto:1003977936@qq.com?subject=MusePDF%20sponsor%20slot';
const SPONSOR_SLOTS = 8;

function sponsorBlock() {
  const tiles = Array.from({ length: SPONSOR_SLOTS }, (_, i) => (i === 0
    ? `<li><a class="hp-sponsor-slot hp-sponsor-slot--open" href="${attr(SPONSOR_MAILTO)}">
                        <span class="hp-sponsor-slot-title">${esc(c('Your logo here'))}</span>
                        <span class="hp-sponsor-slot-note">${esc(c('Reach people who work with PDFs every day.'))}</span>
                    </a></li>`
    : `<li><a class="hp-sponsor-slot" href="${attr(SPONSOR_MAILTO)}" aria-label="${attr(a('Advertise here'))}">
                        ${lucideSvg('plus', 'hp-sponsor-plus')}
                    </a></li>`));
  return `<section class="hp-section hp-sponsor" aria-labelledby="hp-sponsor-label">
            <div class="hp-container">
                <div class="hp-sponsor-panel">
                    <div class="hp-sponsor-head">
                        <h2 class="hp-sponsor-label" id="hp-sponsor-label">${esc(c('Sponsored'))}</h2>
                        <a class="hp-sponsor-cta" href="${attr(SPONSOR_MAILTO)}">${esc(c('Advertise here'))}</a>
                    </div>
                    <ul class="hp-sponsor-grid">
                    ${tiles.join('\n                    ')}
                    </ul>
                </div>
            </div>
        </section>`;
}

function hpNav(alternates) {
  const groupLinks = GROUPS.map((g) => `<a href="/#${slugifyGroup(g)}">${esc(c(g))}</a>`).join('\n                    ');
  return `<a class="hp-skip" href="#all-tools">${esc(c('Skip to all tools'))}</a>
    <header class="hp-nav">
        <nav class="hp-container hp-nav-row" aria-label="${attr(a('Main'))}">
            <a class="hp-brand" href="/" aria-label="${attr(a(`${cfg.siteName} home`))}">
                ${brandMark(28)}
                <span>${esc(cfg.siteName)}</span>
            </a>
            <div class="hp-nav-links">
                ${groupLinks}
            </div>
            <div class="hp-nav-tools">
                ${ghBadge()}
                ${langSwitch({ lang: 'en', en: alternates.en, zh: alternates.zh })}
                <a class="hp-btn hp-btn-ghost" href="/#all-tools">${esc(c('All tools'))}</a>
            </div>
        </nav>
    </header>`;
}

function hpFooter() {
  const cols = GROUPS.map((g) => `<div>
                    <h2>${esc(c(g))}</h2>
                    <ul>${groupOf(g).map((p) => `<li><a href="/${p.slug}/">${esc(reg(p.name, zp(p).name))}</a></li>`).join('')}</ul>
                </div>`).join('\n                ');
  return `<footer class="hp-footer">
        <div class="hp-container">
            <div class="hp-footer-grid">
                <div class="hp-footer-brand">
                    <a class="hp-brand" href="/" style="color:#fff">
                        ${brandMark(28)}
                        <span>${esc(cfg.siteName)}</span>
                    </a>
                    <p>${esc(tpl('Free, private PDF tools that run in your browser. {n} tools, local by default, no account.', ZH.templates?.footerTagline, PAGE_VARS))}</p>
                </div>
                ${cols}
            </div>
            <div class="hp-footer-bottom">
                <span class="hp-footer-legal">${esc(tpl('© {year} {site}.', ZH.templates?.footerCopyright, PAGE_VARS))}</span>
                <ul>
                    <li><a href="/about.html">${esc(c('About'))}</a></li>
                    <li><a href="/vs/">${esc(c('Compare'))}</a></li>
                    <li><a href="/faq.html">${esc(c('FAQ'))}</a></li>
                    <li><a href="/contact.html">${esc(c('Contact'))}</a></li>
                    <li><a href="/licenses.txt">${esc(c('Licences'))}</a></li>
                    <li><a href="/privacy.html">${esc(c('Privacy'))}</a></li>
                    <li><a href="/terms.html">${esc(c('Terms'))}</a></li>
                    <li><a href="/llms.txt">llms.txt</a></li>
                </ul>
            </div>
        </div>
    </footer>`;
}

/** Hero drop widget: detects a dropped file locally and suggests the matching tool pages. */
function hpHeroDrop() {
  return `<div class="hp-drop" id="hp-drop">
            <svg class="hp-drop-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${HP_ICONS.upload}"/></svg>
            <strong>${esc(c('Drop a file here, or click to choose one'))}</strong>
            <span>${esc(c('PDF, Word, Excel, PowerPoint, images and more — then pick the tool you need'))}</span>
            <input type="file" id="hp-drop-input" class="hp-visually-hidden" multiple aria-label="${attr(c('Choose a file to open with MusePDF'))}">
            <div class="hp-drop-chips" id="hp-drop-chips" hidden></div>
        </div>`;
}

const HP_SUGGEST = {
  pdf: ['merge-pdf', 'split-pdf', 'compress-pdf', 'sign-pdf', 'pdf-to-word', 'ocr-pdf'],
  image: ['jpg-to-pdf', 'png-to-pdf', 'image-to-pdf', 'heic-to-pdf', 'webp-to-pdf'],
  docx: ['word-to-pdf', 'txt-to-pdf', 'markdown-to-pdf'],
  text: ['txt-to-pdf', 'markdown-to-pdf'],
  other: ['merge-pdf', 'compress-pdf', 'pdf-to-jpg', 'organize-pdf'],
};

function hpSuggestData() {
  return JSON.stringify(Object.fromEntries(Object.entries(HP_SUGGEST).map(([kind, slugs]) => [
    kind,
    slugs.filter((s) => bySlug[s]).map((s) => ({ slug: s, name: bySlug[s].name })),
  ])));
}

/**
 * Competitor / third-party brand names that must never enter the shipped search index (they exist in the
 * raw keyword research, not in our copy). Kept in one place so the index filter and any future one agree.
 */
const BRAND_RE = /\b(?:ilovepdf|i love pdf|smallpdf|adobe|acrobat|foxit|sejda|pdf24|nitro|canva|wps|pdf2go|pdf candy)\b/i;

/**
 * The homepage search index: one row per tool page carrying the localised name and group, every keyword the
 * repo already chose for that page (seo/keywords.selected.json) and the curated bilingual aliases
 * (seo/search.aliases.json). Emitting data rather than scraping the DOM keeps a single source of truth — the
 * same English name/group the cards use — while giving the search a real bilingual keyword index instead of a
 * textContent match, which can only ever see the language currently painted on the page.
 */
function hpToolsData() {
  return JSON.stringify(pages.map((p) => {
    const sel = selected[p.slug] || {};
    const aliases = ALIASES[p.slug] || {};
    const terms = [sel.primary, ...(sel.secondary || []), ...(aliases.en || []), ...(aliases.zh || [])]
      .filter((term) => typeof term === 'string' && term.trim())
      .filter((term) => !BRAND_RE.test(term));
    return {
      slug: p.slug,
      name: p.name,
      group: p.group,
      nameZh: zp(p).name || '',
      groupZh: ZH.strings?.[p.group] || p.group,
      terms: [...new Set(terms)],
    };
  }));
}

/* -------------------------------------------------------------------- homepage */

/**
 * The homepage FAQ, in ONE place: the visible <details> block, the English JSON-LD and the Chinese
 * JSON-LD all read it, so a translation can never drift from the question it translates. The strings
 * go through `c()` on the page, which is what registers them as dictionary keys.
 */
const homeFaq = () => [
  ['Is MusePDF free?', 'The {n} local tools are free with no signup, no watermark and no daily limit. Optional cloud features cost server time, so they are metered and some will be paid.'],
  ['Do my files get uploaded?', 'For the {n} local tools, no — they run in your browser and your file stays on your device. Optional cloud features (AI, very large files) upload the file, or the text they need, for that step only.'],
  ['Do I need to install anything?', 'No. MusePDF runs in any modern browser on desktop, tablet or phone, and works offline once loaded.'],
  ['How many tools does MusePDF include?', 'MusePDF includes {n} PDF tools covering merging, splitting, converting, editing, organising, optimising and securing documents.'],
  ['What happens to my file when I use a cloud feature?', 'It is used only to produce your result for that one step, and cloud steps are always opt-in.'],
];

function homePage() {
  const canonical = SITE + '/';
  const all = pages;
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: cfg.siteName,
      url: canonical,
      description: cfg.tagline,
      inLanguage: 'en',
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: cfg.organization.name,
      url: SITE,
      logo: SITE + cfg.organization.logo,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'MusePDF tools',
      numberOfItems: all.length,
      itemListElement: all.map((p, i) => ({ '@type': 'ListItem', position: i + 1, name: p.name, url: url(p.slug) })),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: homeFaq().map(([name, text]) => ({ '@type': 'Question', name, acceptedAnswer: { '@type': 'Answer', text } })),
    },
  ];

  const card = (p) => `<a class="hp-card" href="/${p.slug}/" data-tool-id="${attr(p.id)}" data-slug="${attr(p.slug)}">
                        ${toolIcon(p.slug)}
                        <span class="hp-card-body">
                            <span class="hp-card-name">${esc(reg(p.name, zp(p).name))}</span>
                            <span class="hp-card-desc">${esc(reg(p.subtitle || p.detail, zp(p).card))}</span>
                        </span>
                    </a>`;

  const groupSections = GROUPS.map((g) => `<section class="hp-section" id="${slugifyGroup(g)}">
            <div class="hp-container">
                <h2>${esc(c(g))}</h2>
                <p class="hp-section-lead">${esc(c(GROUP_BLURB[g]))}</p>
                <div class="hp-grid" data-group="${attr(g)}">
                    ${groupOf(g).map(card).join('\n                    ')}
                </div>
            </div>
        </section>`).join('\n\n        ');

  return `<!DOCTYPE html>
<html lang="en" data-page-lang="en">
<head>
    ${head({
    title: `${cfg.siteName} — ${all.length} Free PDF Tools That Run in Your Browser`,
    description: `Merge, split, compress, sign, convert and edit PDFs free in your browser. ${all.length} private PDF tools — local by default, no signup, no watermark.`,
    canonical,
    jsonLd,
    alternates: { ...altsFor(null), xDefault: canonical },
    css: ['/src/css/theme.css'],
    extra: `\n    <script type="module" src="/src/js/home.ts"></script>`,
  })}
</head>
<body class="hp">
    ${hpNav(langPathsFor(null))}
    <main>
        <section class="hp-hero">
            <div class="hp-container">
                <h1>${esc(tpl('{n} PDF tools that run in your browser — local by default', ZH.templates?.homeH1, PAGE_VARS))}</h1>
                <p class="hp-lead">${esc(c('Merge, split, compress, sign, convert and edit PDFs right here in your browser. Local mode is the default: no upload, no account, no watermark.'))}</p>
                <div class="hp-search">
                    ${hpIcon('search')}
                    <label class="hp-visually-hidden" for="hp-search">${esc(c('Search tools'))}</label>
                    <input type="search" id="hp-search" placeholder="${attr(a('Search a tool — merge, compress, sign, convert…'))}" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="hp-suggest-list" aria-autocomplete="list">
                    <div class="hp-suggest" id="hp-suggest-box" hidden>
                        <ul class="hp-suggest-list" id="hp-suggest-list" role="listbox"></ul>
                        <p class="hp-suggest-empty" id="hp-suggest-empty" hidden>${esc(c('No tools match your search.'))}</p>
                    </div>
                </div>
                ${hpHeroDrop()}
                <p class="hp-trust">
                    <span>${hpIcon('check')} ${esc(c('Local by default'))}</span>
                    <span>${hpIcon('check')} ${esc(c('No signup'))}</span>
                    <span>${hpIcon('check')} ${esc(c('No watermark'))}</span>
                    <span>${hpIcon('check')} ${esc(c('Works offline once loaded'))}</span>
                </p>
            </div>
        </section>

        <section class="hp-band">
            <div class="hp-container hp-band-inner">
                <div class="hp-cols">
                    <div class="hp-info" style="border:0">
                        ${hpIcon('shield')}
                        <h3>${esc(c('Local by default, on your device'))}</h3>
                        <p>${esc(c('Every one of the {n} tools runs with JavaScript and WebAssembly in your own browser tab. In local mode there is no upload step and no server-side copy. Cloud features — only the ones you choose — are the single labelled exception.'))}</p>
                    </div>
                    <div class="hp-info" style="border:0">
                        ${hpIcon('spark')}
                        <h3>${esc(c('Fast, even for large files'))}</h3>
                        <p>${esc(c('No upload queue means a 200-page document is processed at the speed of your own machine — and it keeps working offline once the page has loaded.'))}</p>
                    </div>
                    <div class="hp-info" style="border:0">
                        ${hpIcon('check')}
                        <h3>${esc(c('Free with no catch'))}</h3>
                        <p>${esc(c('No account, no trial, no watermark and no daily cap for the {n} local tools. The project is open source under Apache-2.0, so you can read every line of what runs.'))}</p>
                    </div>
                </div>
            </div>
        </section>

        <section class="hp-section" id="two-modes">
            <div class="hp-container">
                <h2>${esc(c('Two modes, one site'))}</h2>
                <div class="hp-cols">
                    <div class="hp-info">
                        ${hpIcon('upload')}
                        <h3>${esc(c('Local mode — the default'))}</h3>
                        <p>${esc(c('All {n} tools run in your browser with JavaScript and WebAssembly. Your file is opened on your device and not sent anywhere: free, no account and no daily cap. Nothing to install.'))}</p>
                    </div>
                    <div class="hp-info">
                        ${hpIcon('spark')}
                        <h3>${esc(c('Cloud mode — optional, metered'))}</h3>
                        <p>${esc(c('Some features will need more power than a browser tab can give — talking to a PDF, translation, table extraction, OCR, PDF to PowerPoint, and very large files. When you choose one of those, the file (or the part of its text that step needs) is uploaded for that step only. They are labelled and metered, and they only ever run when you pick them.'))}</p>
                    </div>
                </div>
            </div>
        </section>

        <section class="hp-section" id="all-tools">
            <div class="hp-container">
                <h2>${esc(tpl('All {n} PDF tools', ZH.templates?.allTools, PAGE_VARS))}</h2>
                <p class="hp-section-lead">${esc(c('Pick a tool, drop in your file, download the result. Each tool below has its own page and runs locally in your browser.'))}</p>
            </div>
        </section>

        ${groupSections}

        ${sponsorBlock()}

        <section class="hp-section">
            <div class="hp-container">
                <h2>${esc(c('How MusePDF works'))}</h2>
                <p class="hp-section-lead">${esc(c('Three steps, no account, nothing installed.'))}</p>
                <ol class="hp-steps">
                    <li>
                        <h3>${esc(c('Choose a tool'))}</h3>
                        <p>${esc(c('Open the page for the job you need — merge, split, compress, convert, sign, protect and {rest} more.'))}</p>
                    </li>
                    <li>
                        <h3>${esc(c('Drop in your file'))}</h3>
                        <p>${esc(c('Your document is read locally in your browser. In local mode nothing is uploaded, so confidential files stay confidential.'))}</p>
                    </li>
                    <li>
                        <h3>${esc(c('Download the result'))}</h3>
                        <p>${esc(c('Save the finished file straight to your device. No watermark, no signup wall, no waiting in a queue.'))}</p>
                    </li>
                </ol>
            </div>
        </section>

        <section class="hp-section">
            <div class="hp-container">
                <h2>${esc(c('Frequently asked questions'))}</h2>
                <div class="hp-faq">
                    ${jsonLd[3].mainEntity.map((m, i) => `<details${i === 0 ? ' open' : ''}>
                        <summary>${esc(c(m.name))}</summary>
                        <p>${esc(c(m.acceptedAnswer.text))}</p>
                    </details>`).join('\n                    ')}
                </div>
            </div>
        </section>
    </main>
    ${hpFooter()}
    <script id="hp-suggest" type="application/json">${hpSuggestData()}</script>
    <script id="hp-tools" type="application/json">${hpToolsData()}</script>
    ${GA_BOOT}
</body>
</html>
`;
}

/**
 * Gives the hand-written support pages the same EN / 中文 control the generated pages carry: two real
 * links, the Chinese one pointing at the `/zh/` twin of this very file. Marked, and a marked block is
 * REPLACED rather than skipped, so an older button-based control is upgraded on the next run. Pages
 * with no module entry of their own also get the i18n runtime.
 */
function injectLangControl(html, { script = false, en, zh } = {}) {
  const MARK = '<!-- seo:lang -->';
  const control = `${MARK}\n                        ${ghBadge()}\n                        ${langSwitch({ lang: 'en', en, zh })}`;
  const block = /<!-- seo:lang -->[\s\S]*?<div class="lang-switch"[\s\S]*?<\/div>/g;
  let out = html.replace(block, () => control);
  if (out === html) {
    out = html.replace(
      /([ \t]*)(<a href="(?:\.\/)?index\.html#tools-header" class="nav-link">All Tools<\/a>)/g,
      (match, indent, link) => `${indent}${link}\n${indent}${control}`,
    );
  }
  if (out === html) return html;
  if (script && !out.includes('/src/js/i18n/boot.ts')) {
    out = out.replace(/<\/body>/, `    <script type="module" src="/src/js/i18n/boot.ts"></script>\n</body>`);
  }
  return out;
}

/**
 * Give a hand-written support page the same analytics wiring the generated pages get: the three
 * `analytics` config tags in the head and the deferred loader bootstrap before `</body>`. Both are
 * marked, and a marked block is REPLACED rather than skipped, so editing `GA_BOOT`/`GA_META` above
 * lands on the next run. The footer consent-control island a previous round injected is removed.
 */
function injectAnalytics(html) {
  let out = html;
  const bootBlock = /<!-- seo:analytics-boot -->[\s\S]*?<\/script>/;
  // Matches the OLD single-meta block and the new three-meta block, so a re-run never stacks tags.
  const metaBlock = /<!-- seo:analytics -->(?:\s*<meta name="(?:gtm-container-id|ga4-measurement-id|analytics-consent-mode)"[^>]*>)+/;
  const labelBlock = /<!-- seo:analytics-labels -->[\s\S]*?data-ga-label="on">[\s\S]*?<\/span>\s*<\/span>\s*/;
  // A previously injected head snippet is removed before GA_META goes back in. metaBlock only spans
  // the comment and the meta tags, so without this strip a re-run leaves the old <script> pair behind
  // and the page ends up with two gtag snippets and two `gtag('config')` calls — double-counted hits.
  const headSnippet = /[ \t]*<!-- Google tag \(gtag\.js\)[^\n]*-->\s*<script async src="https:\/\/www\.googletagmanager\.com\/gtag\/js[\s\S]*?window\.__musepdfGaHead = true;\s*<\/script>/g;
  out = out.replace(headSnippet, '');
  out = bootBlock.test(out) ? out.replace(bootBlock, GA_BOOT) : out.replace(/<\/body>/, `${GA_BOOT}\n</body>`);
  out = metaBlock.test(out) ? out.replace(metaBlock, GA_META) : out.replace(/(<meta charset="UTF-8">)/, `$1\n${GA_META}`);
  // No consent UI any more: drop the island a previous run left behind (a no-op on the next round).
  if (labelBlock.test(out)) out = out.replace(labelBlock, '');
  return out;
}

/**
 * Support pages (about / faq / contact / privacy / terms) ship without a canonical or a meta
 * description, which makes them duplicate-content hosts next to the new landing pages. Inject the
 * missing head tags once, marked so re-runs are no-ops — and give them the language control, which
 * needs a script tag because these pages have no other module entry.
 */
/** "the 61 local tools", "All 61 PDF tools", "61 core tools" — a count word-pair, in either language. */
const COUNT_IN_PROSE = /(\b\d{1,4}\b)(?=\s+(?:(?:free|private|local|core|browser-based|web-based|个)\s*)*(?:PDF\s+)?(?:tools?|个工具)\b)/gi;
/** Rewrite every prose tool-count to TOOL_COUNT. Idempotent: a rebuild on the same page is a no-op. */
const stampToolCount = (html) => html.replace(COUNT_IN_PROSE, String(TOOL_COUNT));

function injectSupportHead() {
  const SUPPORT = {
    'about.html': ['About MusePDF — Free, Private, Browser-Based PDF Tools', 'Who builds MusePDF, why every tool runs client-side, and what the project stands for.'],
    'faq.html': ['MusePDF FAQ — Privacy, Limits and How the Tools Work', 'Answers about file privacy, size limits, offline use, licensing and the tools included in MusePDF.'],
    'contact.html': ['Contact MusePDF — Support, Bugs and Feature Requests', 'How to reach the MusePDF maintainers for bug reports, feature requests or security reports.'],
    'privacy.html': ['Privacy Policy — What Is Local and What Is Uploaded', 'What MusePDF does and does not collect: the {n} local tools never upload your file, and cloud features are the labelled exception.'],
    'terms.html': ['Terms and Conditions — MusePDF', 'The terms that apply when you use the free MusePDF tools and website.'],
  };
  const MARK = '<!-- seo:head -->';
  const ALT = /<!-- seo:hreflang -->[\s\S]*?<!-- \/seo:hreflang -->/;
  let touched = 0;
  for (const [file, [title, descRaw]] of Object.entries(SUPPORT)) {
    const desc = fill(descRaw, PAGE_VARS);
    const name = file.replace(/\.html$/, '');
    const abs = path.join(ROOT, file);
    if (!fs.existsSync(abs)) continue;
    let html = fs.readFileSync(abs, 'utf8');
    const before = html;
    if (!html.includes(MARK)) {
      const canonical = `${SITE}/${file}`;
      const head = `${MARK}
    <meta name="description" content="${attr(desc)}">
    <link rel="canonical" href="${attr(canonical)}">
    <meta name="robots" content="index, follow">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="${attr(cfg.siteName)}">
    <meta property="og:title" content="${attr(title)}">
    <meta property="og:description" content="${attr(desc)}">
    <meta property="og:url" content="${attr(canonical)}">
    <meta property="og:image" content="${attr(SITE + cfg.ogImage)}">
    <meta name="twitter:card" content="summary_large_image">`;
      html = html.replace(/(<meta charset="UTF-8">)/, `$1\n${head}`);
      // their <title> keeps the page name; align it with the meta description wording
      html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`);
    }
    // The page declares its own language (the i18n runtime trusts this, not the browser preference).
    html = html.replace(/<html lang="en">/, '<html lang="en" data-page-lang="en">');
    // The reciprocal hreflang triple + og:locale, marked so a re-run replaces instead of stacking.
    const alts = altsForSupport(name);
    const altBlock = `<!-- seo:hreflang -->
    <meta property="og:locale" content="en_US">
    <link rel="alternate" hreflang="en" href="${attr(alts.en)}">
    <link rel="alternate" hreflang="zh-CN" href="${attr(alts.zh)}">
    <link rel="alternate" hreflang="x-default" href="${attr(alts.en)}">
    <!-- /seo:hreflang -->`;
    html = ALT.test(html)
      ? html.replace(ALT, () => altBlock)
      : html.replace(/([ \t]*<link rel="canonical"[^>]*>)/, `$1\n    ${altBlock}`);
    const paths = langPathsForSupport(name);
    html = injectLangControl(html, { script: true, en: paths.en, zh: paths.zh });
    html = injectAnalytics(html);
    // The number of tools in this hand-written body copy moves with seo/pages.meta.json, exactly as
    // `{n}` does in the generated pages. The sentence is recognised by its wording ("the 61 local
    // tools", "the 61 core tools"), so the file needs no token and a rebuild after adding a tool can
    // never leave a stale count behind. assertToolCount() below verifies the result.
    html = stampToolCount(html);
    // The old single tag (`rel="icon" type="image/png" href="images/favicon.svg"`) mislabelled an
    // SVG as a PNG and advertised nothing else; swap it for the shared set exactly once.
    if (!html.includes('<!-- seo:icons -->')) {
      html = html.replace(/[ \t]*<link rel="icon"[^>]*>/, ICONS);
    }
    if (html !== before) {
      fs.writeFileSync(abs, html, 'utf8');
      touched++;
    }
  }
  return touched;
}

/* ------------------------------------------------- build-time 简体中文 (pre-rendered) */

/**
 * THE CHINESE PAGE SET — pre-rendered, not injected at runtime.
 *
 * Every English page is generated in memory first; that pass is also where the EN -> 中文 dictionary
 * is built, at the exact place each English string is emitted. Only then is each page rendered a
 * second time in Simplified Chinese and written to `/zh/<slug>/index.html`, so the Chinese text is IN
 * the served HTML: a crawler that runs no JavaScript sees the same page a visitor does.
 *
 * The translation pass is a deliberate port of `src/js/i18n/init.ts`, because the runtime and this
 * renderer must agree on every key:
 *   - only standalone TEXT nodes are rewritten, so the markup stays the English markup;
 *   - the lookup key is the WHITESPACE-NORMALISED text (`NORM`), which is what the runtime uses and
 *     what `scripts/make-zh-dictionary.mjs` keys the dictionary by;
 *   - script / style / noscript / template / code / pre and `[data-i18n-skip]` subtrees are skipped;
 *   - `placeholder`, `aria-label` and `title` come from the same `attrs` map;
 *   - text with no letter at all (punctuation, digits) is never translated.
 *
 * What IS different, because a Chinese page is a Chinese document from the start: the <title> and
 * meta description are the authored Chinese ones (seo/zh.pages.json), the canonical points at the
 * Chinese URL and NEVER at `/`, `og:locale` is `zh_CN`, the JSON-LD carries the Chinese copy plus
 * `"inLanguage": "zh-CN"`, every internal link points at the Chinese twin, and the EN / 中文 control
 * is the pair of real links. The tool page keeps its `data-tool` and its JS entry, so it still runs.
 *
 * `auditZhPage()` re-walks each page that was written and FAILS THE BUILD when a Chinese page still
 * shows an English string the dictionary can translate — the same failure mode the browser-side gate
 * (scripts/audit-i18n-sweep.mjs) looks for.
 */
/* eslint-disable prefer-const */
let ZH_STRINGS = ZH.strings ?? {};
let ZH_ATTRS = ZH.attrs ?? {};
/**
 * Freeze the EN → 中文 dictionary. It can only be built AFTER the English pages have been generated,
 * because that pass is what pairs every emitted English string with its Chinese (see `reg`/`c`/`tpl`).
 * Calling it earlier would translate with the hand-authored half only.
 */
function compileZhDictionary() {
  // A `{n}` / `{rest}` entry in seo/i18n.zh.json is a TEMPLATE. The hand-written support pages are
  // not emitted through `c()` — their numbers are stamped into the HTML by stampToolCount — so their
  // translated twin needs the FILLED pair in the dictionary: the sentence a visitor sees on the
  // English page → the sentence with the same number on the Chinese one. Registered before the
  // snapshot below, which is what zhRender/auditZhPage read.
  for (const [en, zhText] of Object.entries(ZH.strings ?? {})) {
    if (!/\{\w+\}/.test(en) || !zhText) continue;
    reg(fill(en, PAGE_VARS), fill(zhText, PAGE_VARS));
  }
  ZH_STRINGS = { ...(ZH.strings ?? {}), ...Object.fromEntries(DICT) };
  ZH_ATTRS = { ...(ZH.attrs ?? {}), ...Object.fromEntries(ATTR_DICT) };
  return { strings: Object.keys(ZH_STRINGS).length, attrs: Object.keys(ZH_ATTRS).length };
}
const NORM = (value) => String(value).replace(/\s+/g, ' ').trim();
const HAS_LETTER = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/;
const CJK = /[\u3400-\u9FFF\uF900-\uFAFF]/;
const ZH_SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'CODE', 'PRE']);
const ZH_ATTR_NAMES = ['placeholder', 'aria-label', 'title'];
/** Latin strings that stay Latin on a Chinese page by design: brand, product and file names. */
const ZH_KEEP = new Set([...(ZH.keepEnglish ?? []), 'MusePDF', 'EN', 'llms.txt', 'licenses.txt']);
/** Long English phrases that are intentional on a Chinese page (empty today; a place to record one). */
const ZH_KEEP_UNEXPLAINED = new Set();
/** A "sentence" for the audit: long enough to be prose, with a real Latin word, and no CJK at all. */
const LOOKS_ENGLISH = (text) => text.length >= 25 && /[A-Za-z]{4}/.test(text) && !CJK.test(text);

const ZH_LINK_ATTR = { A: 'href', AREA: 'href', IMG: 'src', SCRIPT: 'src', SOURCE: 'src', LINK: 'href', FORM: 'action' };

function zhSkipped(el) {
  for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
    if (ZH_SKIP_TAGS.has(node.tagName)) return true;
    if (node.hasAttribute('data-i18n-skip')) return true;
  }
  return false;
}

/** Where a link on a Chinese page must point: its twin when the target is a page, else root-absolute. */
function zhLink(value, enUrl, origin) {
  if (!value) return value;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) {
    if (!/^https?:/i.test(value)) return value;
    let url;
    try { url = new URL(value); } catch { return value; }
    if (url.origin !== origin) return value;
    const twin = zhPath(url.pathname);
    return twin ? `${twin}${url.search}${url.hash}` : value;
  }
  if (value.startsWith('#')) return value;
  let url;
  try { url = new URL(value, enUrl); } catch { return value; }
  if (url.origin !== origin) return value;
  const twin = zhPath(url.pathname);
  // A page gets its twin; anything else (an image, a .txt) becomes root-absolute so it still
  // resolves from a nested `/zh/<page>/` directory.
  return twin ? `${twin}${url.search}${url.hash}` : `${url.pathname}${url.search}${url.hash}`;
}

function zhLinks(doc, enUrl) {
  const origin = new URL(SITE).origin;
  const targets = 'a[href], area[href], img[src], script[src], source[src], link[href], form[action]';
  for (const el of Array.from(doc.querySelectorAll(targets))) {
    if (el.hasAttribute('data-lang')) continue; // the switch is set explicitly (see zhSwitch)
    if (el.tagName === 'LINK') {
      const rel = (el.getAttribute('rel') || '').toLowerCase();
      if (rel === 'canonical' || rel === 'alternate') continue;
    }
    const name = ZH_LINK_ATTR[el.tagName];
    if (!name) continue;
    const current = el.getAttribute(name);
    const next = zhLink(current, enUrl, origin);
    if (next && next !== current) el.setAttribute(name, next);
  }
}

/** The head of a Chinese page: its own title/description/canonical, and the reciprocal hreflang pair. */
function zhHead(doc, { enUrl, zhUrl, title, description }) {
  const setMeta = (selector, value) => {
    const el = doc.querySelector(selector);
    if (el) el.setAttribute('content', value);
  };
  const heading = doc.querySelector('title');
  if (heading) heading.textContent = title;
  setMeta('meta[name="description"]', description);
  setMeta('meta[property="og:locale"]', 'zh_CN');
  setMeta('meta[property="og:title"]', title);
  setMeta('meta[property="og:description"]', description);
  setMeta('meta[property="og:url"]', zhUrl);
  setMeta('meta[name="twitter:title"]', title);
  setMeta('meta[name="twitter:description"]', description);
  const canonical = doc.querySelector('link[rel="canonical"]');
  if (canonical) canonical.setAttribute('href', zhUrl);
  for (const [lang, href] of [['en', enUrl], ['zh-CN', zhUrl], ['x-default', enUrl]]) {
    const el = doc.querySelector(`link[rel="alternate"][hreflang="${lang}"]`);
    if (el) el.setAttribute('href', href);
  }
}

/** The EN / 中文 control on a Chinese page: 中文 is current, EN navigates back to the English page. */
function zhSwitch(doc, paths) {
  for (const link of Array.from(doc.querySelectorAll('a[data-lang]'))) {
    const side = link.getAttribute('data-lang') === 'zh' ? 'zh' : 'en';
    link.setAttribute('href', paths[side]);
    if (side === 'zh') link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

/** Translate one page's copy in place — the runtime's own walk, over the generated markup. */
function zhTranslate(doc) {
  const walker = doc.createTreeWalker(doc.body, 4 /* SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || zhSkipped(parent)) continue;
    const edge = /^(\s*)([\s\S]*?)(\s*)$/.exec(node.data);
    if (!edge) continue;
    const [, lead, core, trail] = edge;
    if (!core) continue;
    const key = NORM(core);
    if (!HAS_LETTER.test(key)) continue;
    const translated = ZH_STRINGS[key];
    if (translated === undefined || translated === core) continue;
    node.data = `${lead}${translated}${trail}`;
  }
  for (const el of Array.from(doc.querySelectorAll('*'))) {
    if (el.closest('[data-i18n-skip]')) continue;
    for (const name of ZH_ATTR_NAMES) {
      const value = el.getAttribute(name);
      if (!value) continue;
      const translated = ZH_ATTRS[NORM(value)];
      if (translated !== undefined && translated !== value) el.setAttribute(name, translated);
    }
  }
}

/** Replace the page's JSON-LD with the Chinese blocks (same types, Chinese copy, `inLanguage`). */
function writeJsonLd(doc, blocks) {
  const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
  if (!scripts.length) return false;
  scripts[0].textContent = JSON.stringify(blocks);
  for (const extra of scripts.slice(1)) extra.remove();
  return true;
}

/**
 * The three long-tail questions every Chinese tool page answers, plus the page's own FAQ translated.
 * The questions come from the page's authored override when it has one, otherwise from the shared
 * templates (two common + one per group) filled with that page's own term / name / in / out / detail —
 * so no two pages ask the same thing, and the answer cites what THIS tool actually does.
 */
function zhLongTails(p) {
  const cn = ZHP.tools?.[p.slug] ?? {};
  const z = zp(p);
  const vars = {
    term: cn.term ?? z.name ?? p.name,
    name: z.name ?? p.name,
    in: z.in ?? p.in,
    out: z.out ?? p.out,
    detail: z.detail ?? p.detail,
  };
  const authored = Array.isArray(cn.longTails) && cn.longTails.length === 3 ? cn.longTails : null;
  const list = authored ?? [
    ...(ZHP.longTailTemplates?._common ?? []),
    ...(ZHP.longTailTemplates?.[p.group] ?? []),
  ];
  if (list.length !== 3) throw new Error(`zh: ${p.slug} has ${list.length} long-tail questions (need 3)`);
  return list.map(([q, a]) => {
    const question = fill(q, vars);
    const answer = fill(a, vars);
    if (/[{}]/.test(question) || /[{}]/.test(answer)) {
      throw new Error(`zh: ${p.slug} long-tail has an unfilled placeholder: ${question} / ${answer}`);
    }
    return [question, answer];
  });
}

/** The Chinese FAQ list for a page: the translated page FAQ first, then the long-tail questions. */
function zhFaqs(p, longTails) {
  const page = faqsFor(p)
    .map((f) => ({ q: f.zq || f.q, a: f.za || f.a }))
    .filter((f) => f.q && f.a);
  return [...page, ...longTails.map(([q, a]) => ({ q, a }))];
}

const zhText = (en) => ZH_STRINGS[NORM(en)] ?? en;

function zhToolJsonLd(p, cn, faqs) {
  const z = zp(p);
  const canonical = `${SITE}/zh/${p.slug}/`;
  const name = z.name ?? p.name;
  const features = (z.features ?? []).filter(Boolean);
  const steps = Array.isArray(z.steps) ? z.steps : [];
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      inLanguage: 'zh-CN',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: zhText('Home'), item: `${SITE}/zh/` },
        { '@type': 'ListItem', position: 2, name: zhText(p.group), item: `${SITE}/zh/#${slugifyGroup(p.group)}` },
        { '@type': 'ListItem', position: 3, name, item: canonical },
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      inLanguage: 'zh-CN',
      name: `${name} — ${cfg.siteName}`,
      url: canonical,
      applicationCategory: 'UtilitiesApplication',
      operatingSystem: '任何现代浏览器',
      browserRequirements: '需要启用 JavaScript',
      isAccessibleForFree: true,
      description: cn.description,
      featureList: features.length ? features : [z.detail ?? p.detail],
      // `price: 0` is scoped to THIS local tool: the local tools are free, but optional cloud features
      // are metered, so a bare station-level `price: 0` would be structured data that lies.
      offers: {
        '@type': 'Offer',
        name: '免费本地工具',
        price: '0',
        priceCurrency: 'USD',
        description: '这个工具在你的浏览器里运行，而且是免费的；可选的云端功能按量计费。',
      },
      publisher: { '@type': 'Organization', name: cfg.organization.name, url: SITE },
      keywords: [cn.term, p.kw].filter(Boolean).join(', '),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'HowTo',
      inLanguage: 'zh-CN',
      name: cn.howTo,
      totalTime: 'PT1M',
      tool: [{ '@type': 'HowToTool', name: `${cfg.siteName} ${name}` }],
      step: steps.map((s, i) => ({ '@type': 'HowToStep', position: i + 1, name: s[0], text: s[1] || s[0] })),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      inLanguage: 'zh-CN',
      mainEntity: faqs.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
  ];
}

function zhHomeJsonLd() {
  const canonical = `${SITE}/zh/`;
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: cfg.siteName,
      url: canonical,
      description: ZHP.home?.description,
      inLanguage: 'zh-CN',
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: cfg.organization.name,
      url: SITE,
      logo: SITE + cfg.organization.logo,
      inLanguage: 'zh-CN',
    },
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      inLanguage: 'zh-CN',
      name: `${cfg.siteName} 工具`,
      numberOfItems: pages.length,
      itemListElement: pages.map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: zp(p).name ?? p.name,
        url: `${SITE}/zh/${p.slug}/`,
      })),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      inLanguage: 'zh-CN',
      mainEntity: homeFaq().map(([name, text]) => ({
        '@type': 'Question',
        name: zhText(name),
        acceptedAnswer: { '@type': 'Answer', text: zhText(text) },
      })),
    },
  ];
}

/** Append the long-tail questions to the page's EXISTING FAQ block (same markup, same CSS). */
function zhAppendLongTails(doc, longTails) {
  const box = doc.querySelector('.hp-faq');
  if (!box) throw new Error('zh: no .hp-faq block to extend');
  for (const [question, answer] of longTails) {
    const details = doc.createElement('details');
    const summary = doc.createElement('summary');
    summary.textContent = question;
    const body = doc.createElement('p');
    body.textContent = answer;
    details.append(summary, body);
    box.append(details);
  }
}

/** Render the Chinese twin of an English page. Returns the serialised HTML and the document it came from. */
function zhRender({ enHtml, enUrl, zhUrl, paths, title, description, jsonLd, longTails = [] }) {
  const dom = new JSDOM(enHtml);
  const doc = dom.window.document;
  doc.documentElement.setAttribute('lang', 'zh-CN');
  doc.documentElement.setAttribute('data-page-lang', 'zh');
  zhHead(doc, { enUrl, zhUrl, title, description });
  zhLinks(doc, enUrl);
  zhSwitch(doc, paths);
  zhTranslate(doc);
  if (jsonLd) writeJsonLd(doc, jsonLd);
  if (longTails.length) zhAppendLongTails(doc, longTails);
  return { html: dom.serialize(), doc };
}

/* ------------------------------------------------------------ the Chinese self-check */

const ZH_PROBLEMS = [];
const ZH_AUDITED = [];

/**
 * Walks the Chinese page exactly the way the runtime walker does and collects anything that is still
 * English when the dictionary has (or should have) Chinese for it:
 *   `untranslated`        a text node whose English key IS in the dictionary — the renderer missed it;
 *   `untranslated-attr`   same, for placeholder / aria-label / title;
 *   `english-leftover`    a whole English sentence with no dictionary entry — nobody noticed it.
 * Any of them fails the build (see the exit below), which is what keeps the Chinese page set honest.
 */
function auditZhPage(doc, route) {
  ZH_AUDITED.push(route);
  const walker = doc.createTreeWalker(doc.body, 4 /* SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || zhSkipped(parent)) continue;
    const edge = /^(\s*)([\s\S]*?)(\s*)$/.exec(node.data);
    if (!edge || !edge[2]) continue;
    const key = NORM(edge[2]);
    if (!HAS_LETTER.test(key)) continue;
    const known = ZH_STRINGS[key];
    if (known !== undefined) {
      if (known !== key) ZH_PROBLEMS.push({ route, kind: 'untranslated', text: key });
      continue;
    }
    if (ZH_KEEP.has(key) || ZH_KEEP_UNEXPLAINED.has(key)) continue;
    if (LOOKS_ENGLISH(key)) ZH_PROBLEMS.push({ route, kind: 'english-leftover', text: key });
  }
  for (const el of Array.from(doc.querySelectorAll('*'))) {
    if (el.closest('[data-i18n-skip]')) continue;
    for (const name of ZH_ATTR_NAMES) {
      const value = el.getAttribute(name);
      if (!value) continue;
      const known = ZH_ATTRS[NORM(value)];
      if (known !== undefined && known !== value) ZH_PROBLEMS.push({ route, kind: 'untranslated-attr', text: `${name}=${value}` });
    }
  }
}

/* ----------------------------------------------------------------------- outputs */

const manifestInputs = { main: 'index.html' };
for (const p of pages) {
  const html = inContext(`page:${p.slug}`, () => toolPage(p));
  EN_HTML.set(p.slug, html);
  write(`${p.slug}/index.html`, html);
  manifestInputs[p.slug] = `${p.slug}/index.html`;
}
EN_HTML.set('home', inContext('home', homePage));
write('index.html', EN_HTML.get('home'));
const supportTouched = injectSupportHead();
// Read the support pages back AFTER the head injection, so their Chinese twins carry the same canonical,
// hreflang, icons and language control the English files now have.
for (const name of SUPPORT_PAGES) {
  const abs = path.join(ROOT, `${name}.html`);
  if (fs.existsSync(abs)) EN_HTML.set(name, fs.readFileSync(abs, 'utf8'));
}

/* ---------------------------------------------------------- write the /zh/** pages */

const zhDictCounts = compileZhDictionary();
const zhRoutes = [];
const zhPending = [];
let zhStrings = 0;
/**
 * Render one Chinese page, audit it, and queue it. Nothing is written until EVERY page has passed the
 * audit below, so a page the dictionary cannot translate leaves the tree untouched instead of shipping.
 */
function emitZh({ manifestName, outPath, route, enHtml, enUrl, zhUrl, paths, title, description, jsonLd, longTails }) {
  if (!enHtml) throw new Error(`zh: no English source for ${route}`);
  // `seo/zh.pages.json` may carry a `{n}` token so the tool count stays a single source of truth
  // (TOOL_COUNT from seo/pages.meta.json) instead of a number baked into hand-written Chinese copy.
  const fillN = (s) => (typeof s === 'string' ? s.replace(/\{n\}/g, String(TOOL_COUNT)) : s);
  title = fillN(title); description = fillN(description);
  if (Array.isArray(longTails)) longTails = longTails.map((row) => (Array.isArray(row) ? row.map(fillN) : fillN(row)));
  const { html, doc } = zhRender({ enHtml, enUrl, zhUrl, paths, title, description, jsonLd, longTails });
  auditZhPage(doc, route);
  zhPending.push({ manifestName, outPath, html });
  zhRoutes.push(route);
  zhStrings += html.length;
}

for (const p of pages) {
  const cn = ZHP.tools?.[p.slug] ?? {};
  if (!cn.title || !cn.description || !cn.howTo) throw new Error(`zh: seo/zh.pages.json has no metadata for ${p.slug}`);
  const longTails = zhLongTails(p);
  emitZh({
    manifestName: `zh-${p.slug}`,
    outPath: `zh/${p.slug}/index.html`,
    route: `/zh/${p.slug}/`,
    enHtml: EN_HTML.get(p.slug),
    enUrl: `${SITE}/${p.slug}/`,
    zhUrl: `${SITE}/zh/${p.slug}/`,
    paths: langPathsFor(p.slug),
    title: cn.title,
    description: cn.description,
    jsonLd: zhToolJsonLd(p, cn, zhFaqs(p, longTails)),
    longTails,
  });
}

emitZh({
  manifestName: 'zh-main',
  outPath: 'zh/index.html',
  route: '/zh/',
  enHtml: EN_HTML.get('home'),
  enUrl: `${SITE}/`,
  zhUrl: `${SITE}/zh/`,
  paths: langPathsFor(null),
  title: ZHP.home.title,
  description: ZHP.home.description,
  jsonLd: zhHomeJsonLd(),
});

for (const name of SUPPORT_PAGES) {
  const cn = ZHP.support?.[name];
  if (!cn) throw new Error(`zh: seo/zh.pages.json has no metadata for the ${name} page`);
  emitZh({
    manifestName: `zh-${name}`,
    outPath: `zh/${name}/index.html`,
    route: `/zh/${name}/`,
    enHtml: EN_HTML.get(name),
    enUrl: `${SITE}/${name}.html`,
    zhUrl: `${SITE}/zh/${name}/`,
    paths: langPathsForSupport(name),
    title: cn.title,
    description: cn.description,
    jsonLd: null,
  });
}

if (ZH_PROBLEMS.length) {
  console.error(`\nzh self-check FAILED — ${ZH_PROBLEMS.length} string(s) should be Chinese and are not:`);
  for (const problem of ZH_PROBLEMS.slice(0, 40)) console.error(`  ${problem.kind}  ${problem.route}  ${problem.text}`);
  if (ZH_PROBLEMS.length > 40) console.error(`  … ${ZH_PROBLEMS.length - 40} more`);
  console.error(`\nNothing was written: fix seo/i18n.zh.json (or seo/zh.pages.json) and run again.`);
  process.exit(1);
}
for (const page of zhPending) {
  write(page.outPath, page.html);
  manifestInputs[page.manifestName] = page.outPath;
}

/* ------------------------------------------------- count assertion (one source of truth) */

/**
 * FAIL THE BUILD when any generated page shows a tool count that disagrees with seo/pages.meta.json.
 *
 * The site used to type "61" into the hero, the JSON-LD, the FAQ answers and the sponsor copy; adding a
 * tool then needed a hunt through HTML, JSON and two dictionaries, and a missed one shipped a lie. The
 * count now comes from TOOL_COUNT, and this pass is the guard: it reads the HTML that was actually
 * generated (English, Chinese and the hand-written support pages) and refuses to write a site whose
 * prose says one number and whose page list says another. `{n}` / `{rest}` left unfilled is the same
 * class of bug, so it fails here too.
 */
function assertToolCount() {
  const docs = [
    { where: '/', html: EN_HTML.get('home') },
    ...pages.map((p) => ({ where: `/${p.slug}/`, html: EN_HTML.get(p.slug) })),
    ...SUPPORT_PAGES.filter((n) => EN_HTML.has(n)).map((n) => ({ where: `/${n}.html`, html: EN_HTML.get(n) })),
    ...zhPending.map((page) => ({ where: `/${page.outPath.replace(/\/index\.html$/, '')}/`, html: page.html })),
  ];
  const problems = [];
  for (const { where, html } of docs) {
    if (!html) continue;
    const noScripts = html.replace(/<script[\s\S]*?<\/script>/g, ' ');
    for (const m of noScripts.matchAll(/(?:\{n\}|\{rest\})/g)) {
      problems.push(`${where}: unfilled ${m[0]} token in the copy`);
    }
    for (const m of noScripts.matchAll(/(\b\d{1,4}\b)(?=\s+(?:(?:free|private|local|core|browser-based|web-based|个)\s*)*(?:PDF\s+)?(?:tools?|个工具)\b)/gi)) {
      if (Number(m[1]) !== TOOL_COUNT) problems.push(`${where}: says "${m[1]} …tools" but the page list has ${TOOL_COUNT}`);
    }
    for (const m of html.matchAll(/"numberOfItems"\s*:\s*(\d+)/g)) {
      if (Number(m[1]) !== TOOL_COUNT) problems.push(`${where}: JSON-LD numberOfItems is ${m[1]}, expected ${TOOL_COUNT}`);
    }
  }
  if (new Set(problems).size) {
    console.error(`\nTOOL COUNT CHECK FAILED — generated copy disagrees with seo/pages.meta.json (${TOOL_COUNT} pages):`);
    for (const problem of [...new Set(problems)].slice(0, 25)) console.error(`  ${problem}`);
    console.error('\nEvery number of tools must come from TOOL_COUNT (a `{n}` token in copy, stampToolCount in a hand-written page).');
    process.exit(1);
  }
  return docs.length;
}
const countChecked = assertToolCount();

/* ------------------------------------------------------------ sitemap / llms / manifest */

/** <lastmod> is the field search engines actually use; derive it from the content sources so it only
 *  moves when the copy config changes, not on every rebuild. */
const SITEMAP_LASTMOD = (() => {
  const srcs = ['seo/pages.copy.json', 'seo/zh.pages.json', 'seo/i18n.zh.json', 'seo/site.config.json'];
  const stamps = srcs.filter((f) => fs.existsSync(f)).map((f) => fs.statSync(f).mtimeMs);
  const t = stamps.length ? Math.max(...stamps) : Date.now();
  return new Date(t).toISOString().slice(0, 10);
})();

/** One <url> per language version. Plain sitemaps.org shape (loc/lastmod/changefreq/priority) —
 *  the EN/ZH pairing lives in each page's <link rel="alternate" hreflang> head tags instead. */
function sitemapEntries() {
  const rows = [];
  const pair = (en, zh, changefreq, priority) => {
    for (const loc of [en, zh]) {
      rows.push(
        `<url>\n<loc>${loc}</loc>\n<lastmod>${SITEMAP_LASTMOD}</lastmod>\n<changefreq>${changefreq}</changefreq>\n<priority>${priority}</priority>\n</url>`
      );
    }
  };
  pair(`${SITE}/`, `${SITE}/zh/`, 'weekly', '1.0');
  for (const p of pages) pair(`${SITE}/${p.slug}/`, `${SITE}/zh/${p.slug}/`, 'monthly', '0.8');
  for (const name of SUPPORT_PAGES) pair(`${SITE}/${name}.html`, `${SITE}/zh/${name}/`, 'monthly', '0.5');
  return rows;
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries().join('\n')}
</urlset>
`;

const robots = `# ${cfg.siteName}
User-agent: *
Allow: /

# AI crawlers are welcome: the tool pages are the product.
User-agent: GPTBot
Allow: /
User-agent: OAI-SearchBot
Allow: /
User-agent: ChatGPT-User
Allow: /
User-agent: ClaudeBot
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: BingBot
Allow: /
User-agent: Google-Extended
Allow: /

Sitemap: ${SITE}/sitemap.xml
`;

const llms = `# ${cfg.siteName}

> ${cfg.tagline}. ${pages.length} PDF tools that run in your browser — local by default: no upload for the local tools, no account, no watermark. A Simplified-Chinese mirror of the whole tool set lives under ${SITE}/zh/.

## What this site is
${cfg.siteName} is a browser-based PDF toolkit. Each tool page below performs one task locally
using JavaScript and WebAssembly (pdf-lib, pdf.js, Tesseract.js, pdfkit). The ${pages.length} local tools never
upload your files, so they are safe for contracts, invoices, medical records and other confidential
documents. Optional cloud features — AI and very large files — are labelled, are metered, and upload
only when you choose them.

## Facts an assistant can rely on
- Price: the ${pages.length} local tools are free, with no account, no watermark and no daily limit; cloud features are metered.
- Privacy model: local by default — the ${pages.length} local tools process client-side and no file reaches a server. Cloud features are the labelled, opt-in exception.
- Languages: English at the URLs below, Simplified Chinese at the same slug under ${SITE}/zh/ (server-rendered, same tools).
- Platforms: any modern browser on Windows, macOS, Linux, Android or iOS.
- Offline: the local tools work after first load (PWA-ready static site).
- Licence: Apache-2.0.

## Tools
${pages.map((p) => `- [${p.name}](${url(p.slug)}): ${p.detail}`).join('\n')}

## Optional
- [Homepage](${SITE}/)
- [About](${SITE}/about.html)
- [FAQ](${SITE}/faq.html)
- [Privacy](${SITE}/privacy.html)

## 中文页面 (Simplified Chinese, same ${pages.length} tools)
The Chinese set mirrors the English one one-for-one; every /zh/ page is server-rendered HTML with a
self-referencing canonical and a reciprocal hreflang pair.
- [首页 / Homepage](${SITE}/zh/)
- [关于 / About](${SITE}/zh/about/)
- [常见问题 / FAQ](${SITE}/zh/faq/)
${pages.map((p) => `- [${zp(p).name ?? p.name}](${SITE}/zh/${p.slug}/): ${zp(p).detail ?? p.detail}`).join('\n')}
`;

write('public/sitemap.xml', sitemap);
write('public/robots.txt', robots);
write('public/llms.txt', llms);
write('seo/pages.manifest.json', JSON.stringify({ inputs: manifestInputs }, null, 2));
/**
 * The EN → 中文 pairs, captured at the exact place every English string is emitted. This file is the
 * generator's half of the dictionary: `scripts/make-zh-dictionary.mjs` merges it with the runtime and
 * workbench strings and writes public/i18n/zh.json. `missing` is the authoring backlog — every English
 * string this run could not pair with a Chinese one, annotated with where it came from.
 *
 * It is collected from the ENGLISH pages only. The `/zh/` pages are Chinese by construction, so
 * extracting from them would only ask for a Chinese→Chinese entry; make-zh-dictionary.mjs skips them
 * for the same reason.
 */
write('seo/i18n.pairs.json', JSON.stringify({
  generated: new Date().toISOString(),
  source: 'scripts/generate-seo-pages.mjs',
  strings: Object.fromEntries([...DICT.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  attrs: Object.fromEntries([...ATTR_DICT.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  missing: [...MISS.entries()].map(([en, where]) => ({ en, where })).sort((a, b) => (a.en < b.en ? -1 : 1)),
}, null, 2) + '\n');

console.log(`generated ${pages.length} tool pages + homepage`);
console.log(`tool count: ${TOOL_COUNT} (single source: seo/pages.meta.json) — ${countChecked} pages checked for a stale number, all agree`);
(() => {
  const { total, verified, fallback, unmapped } = iconReport();
  console.log(`tool icons: ${verified}/${total} lucide names verified, ${fallback.length} fallback, ${unmapped.length} unmapped`);
  if (fallback.length) console.log(`  fallback to ${ICON_FALLBACK}: ${fallback.map((p) => `${p.slug} (${TOOL_ICONS[p.slug]})`).join(', ')}`);
  if (unmapped.length) console.log(`  no icon chosen: ${unmapped.map((p) => p.slug).join(', ')}`);
})();
console.log(`support pages given canonical/description: ${supportTouched}`);
console.log(`inputs: ${Object.keys(manifestInputs).length} (${pages.length + 1} English + ${zhRoutes.length} Chinese)`);
console.log(`zh pages: ${zhRoutes.length} written and audited, ${(zhStrings / 1024).toFixed(0)} KB of Chinese HTML, 0 untranslated`);
console.log(`keywords applied: ${Object.keys(selected).length}`);
console.log(`i18n: ${DICT.size} English strings paired with Chinese, ${ATTR_DICT.size} attributes, ${MISS.size} still untranslated`);
