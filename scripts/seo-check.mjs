/**
 * Post-build SEO validator.
 *
 *   npm run build && node scripts/seo-check.mjs
 *
 * Audits every generated page in dist/ for the things that actually move rankings:
 * unique titles/descriptions, one H1, a canonical, parseable JSON-LD, keyword placement
 * without stuffing, internal links that resolve, a complete sitemap, and alt text on images.
 * Exit code 1 when an error-severity check fails, so it can gate a deploy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const readJson = (p, f = null) => (fs.existsSync(path.join(ROOT, p)) ? JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')) : f);

if (!fs.existsSync(DIST)) {
  console.error('dist/ not found — run `npm run build` first');
  process.exit(2);
}

const cfg = readJson('seo/site.config.json');
const meta = readJson('seo/pages.meta.json', []);
const selected = readJson('seo/keywords.selected.json', {});
const manifest = readJson('seo/pages.manifest.json', { inputs: {} });
/** The authored Chinese metadata for the pre-rendered `/zh/**` pages (titles, terms, long-tails). */
const zhMeta = readJson('seo/zh.pages.json', { tools: {}, support: {}, home: {} });
const SITE_ROOT = cfg.siteUrl.replace(/\/$/, '');
const SUPPORT_FILES = ['about.html', 'faq.html', 'contact.html', 'privacy.html', 'terms.html'];
const SUPPORT_DIRS = new Set(SUPPORT_FILES.map((f) => f.replace(/\.html$/, '')));
/** A page of the Chinese set: `/zh/…`, which has its own language, canonical, og:locale and twins. */
const isZh = (rel) => rel === 'zh/index.html' || rel.startsWith('zh/');
/**
 * The root-relative URLs of a page and its other-language twin, from the page's path inside dist/.
 * These are exactly what the EN / 中文 control links to, so the check compares against them.
 */
const relToPaths = (rel) => {
  if (rel === 'index.html' || rel === 'zh/index.html') return { en: '/', zh: '/zh/' };
  const zhDir = /^zh\/(.+)\/index\.html$/.exec(rel);
  if (zhDir) {
    const name = zhDir[1];
    return SUPPORT_DIRS.has(name) ? { en: `/${name}.html`, zh: `/zh/${name}/` } : { en: `/${name}/`, zh: `/zh/${name}/` };
  }
  const dir = /^(.+)\/index\.html$/.exec(rel);
  if (dir) return { en: `/${dir[1]}/`, zh: `/zh/${dir[1]}/` };
  const file = /^([a-z0-9-]+)\.html$/.exec(rel);
  if (file) return { en: `/${rel}`, zh: `/zh/${file[1]}/` };
  return { en: `/${rel}`, zh: `/${rel}` };
};

const problems = [];
const notes = [];
const add = (sev, page, msg) => problems.push({ sev, page, msg });

const htmlFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs);
    // 404.html is intentionally outside the SEO contract (noindex, no canonical/hreflang/og)
    else if (e.name.endsWith('.html') && e.name !== '404.html') htmlFiles.push(abs);
  }
})(DIST);

const strip = (html) => html
  .replace(/<script[\s\S]*?<\/script>/g, ' ')
  .replace(/<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<nav[\s\S]*?<\/nav>/g, ' ');

/**
 * Editorial text only: headings, paragraphs, list items, answers and table cells inside <main>.
 * Nav, breadcrumb, link cards and the footer are excluded so keyword density reflects real body copy
 * rather than the same tool name repeated in navigation.
 */
function editorialText(html) {
  const main = (html.match(/<main[\s\S]*?<\/main>/) || [html])[0];
  const clean = strip(main);
  const chunks = [...clean.matchAll(/<(p|h1|h2|h3|summary|li|td|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/g)]
    .map((m) => m[2].replace(/<[^>]+>/g, ' '));
  if (!chunks.length) return clean.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return chunks.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Body prose only (no headings, no nav, no link cards). Keyword density is measured against this,
 * because a keyword belongs in the H1 and one H2 by design — counting headings would flag every
 * correctly optimised page as stuffed.
 */
function proseText(html) {
  const main = (html.match(/<main[\s\S]*?<\/main>/) || [html])[0];
  const clean = strip(main);
  const chunks = [...clean.matchAll(/<(p|summary|td|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/g)]
    .map((m) => m[2].replace(/<[^>]+>/g, ' '));
  return chunks.join(' ').replace(/\s+/g, ' ').trim();
}
/**
 * Exact-phrase density over body prose. Headings are excluded (the keyword belongs in the H1 and one
 * H2), so a page that uses its phrase in the intro, one step and one FAQ answer lands near 4%. The
 * 5% ceiling catches genuine repetition — the same phrase in every block — without flagging a normal
 * tool page.
 */
const DENSITY_CEILING = 0.05;
const pages = new Map();
/** canonical URL → { rel, links, zh } — collected here so the reciprocal hreflang check can run after. */
const hreflang = new Map();
const titles = new Map();
const descriptions = new Map();

for (const file of htmlFiles) {
  const rel = path.relative(DIST, file).split(path.sep).join('/');
  const html = fs.readFileSync(file, 'utf8');
  const visible = strip(html);
  const text = editorialText(html);
  const prose = proseText(html);
  const slug = rel === 'index.html' ? '' : rel.replace(/\/index\.html$/, '');

  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [, ''])[1].trim();
  const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [, ''])[1].trim();
  const canonical = (html.match(/<link rel="canonical" href="([^"]*)"/) || [, ''])[1];
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim());
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  const noindex = /<meta name="robots"[^>]*noindex/.test(html);
  const zh = isZh(rel);
  const langAttr = (html.match(/<html[^>]*\slang="([^"]*)"/) || [, ''])[1];
  const pageLangAttr = (html.match(/<html[^>]*data-page-lang="([^"]*)"/) || [, ''])[1];
  const ogLocale = (html.match(/<meta property="og:locale" content="([^"]*)"/) || [, ''])[1];
  const ogUrl = (html.match(/<meta property="og:url" content="([^"]*)"/) || [, ''])[1];
  const altLinks = {};
  for (const m of html.matchAll(/<link rel="alternate" hreflang="([^"]*)" href="([^"]*)"/g)) altLinks[m[1]] = m[2];
  hreflang.set(canonical || rel, { rel, links: altLinks, zh });

  pages.set(slug, { rel, html, text, prose, title, desc, canonical, h1s, slug, zh });

  // ---- per-page checks
  if (!title) add('error', rel, 'missing <title>');
  else if (title.length > 62) add('warn', rel, `title is ${title.length} chars (>62, truncates in SERPs)`);
  else if (title.length < 20) add('warn', rel, `title is only ${title.length} chars`);

  // A Chinese description says much more per character, and its SERP snippet truncates far earlier than
  // a Latin one, so the band is CJK-specific rather than the 70-160 the English pages use.
  if (!noindex) {
    if (!desc) add('error', rel, 'missing meta description');
    else if (desc.length > (zh ? 120 : 160)) add('warn', rel, `description is ${desc.length} chars (>${zh ? 120 : 160})`);
    else if (desc.length < (zh ? 30 : 70)) add('warn', rel, `description is only ${desc.length} chars`);
  }

  if (!noindex) {
    if (!canonical) add('error', rel, 'missing canonical');
    else if (!canonical.startsWith(cfg.siteUrl) && !canonical.startsWith('/')) add('warn', rel, `canonical points off-site: ${canonical}`);
    if (h1s.length !== 1) add('error', rel, `${h1s.length} H1 elements (must be exactly 1)`);
  }

  // ---- language contract, both directions
  if (!noindex) {
    if (zh) {
      if (langAttr !== 'zh-CN') add('error', rel, `<html lang="${langAttr}" on a Chinese page (want zh-CN)`);
      if (pageLangAttr !== 'zh') add('error', rel, `<html data-page-lang="${pageLangAttr}" on a Chinese page (want zh)`);
      // NEVER `/`: the whole point of the Chinese page set is a self-referencing canonical. The path may
      // be nested (`/zh/vs/smallpdf/` — the comparison pages), so this asserts "under /zh/ and a
      // directory URL", not "exactly one segment".
      if (!canonical.startsWith(`${SITE_ROOT}/zh/`) || !canonical.endsWith('/')) {
        add('error', rel, `Chinese canonical is not self-referencing: ${canonical}`);
      }
      if (ogLocale !== 'zh_CN') add('error', rel, `og:locale is "${ogLocale}" on a Chinese page (want zh_CN)`);
      if (ogUrl !== canonical) add('error', rel, `og:url (${ogUrl}) is not the canonical (${canonical})`);
      if (!/[\u3400-\u9FFF]/.test(title)) add('error', rel, 'Chinese page with a <title> that has no Chinese characters');
      for (const block of ld) {
        try {
          const parsed = JSON.parse(block[1]);
          for (const node of (Array.isArray(parsed) ? parsed : [parsed])) {
            if (node && node['@type'] && node.inLanguage !== 'zh-CN') {
              add('error', rel, `JSON-LD ${node['@type']} has no "inLanguage": "zh-CN"`);
            }
          }
        } catch { /* the generic JSON-LD check below reports the parse failure */ }
      }
      const zhFaq = ld.map((b) => { try { return JSON.parse(b[1]); } catch { return null; } })
        .flat().find((node) => node && node['@type'] === 'FAQPage');
      const questions = zhFaq?.mainEntity?.length ?? 0;
      // Tool pages only: the comparison set (`/zh/vs/…`) is a static page, not a tool, so it carries no
      // HowTo/FAQ block of its own — `/vs/` and `/vs/<competitor>/` must not be held to the tool rule.
      const isCompare = rel.startsWith('zh/vs/');
      if (!isCompare && rel !== 'zh/index.html' && /^zh\/[^/]+\/index\.html$/.test(rel) && !SUPPORT_DIRS.has(rel.split('/')[1]) && questions < 7) {
        add('error', rel, `Chinese tool page has ${questions} FAQ questions (want at least 7: the page FAQ + 3 long-tails)`);
      }
    } else {
      if (langAttr !== 'en') add('error', rel, `<html lang="${langAttr}" on an English page (want en)`);
      if (pageLangAttr !== 'en') add('error', rel, `<html data-page-lang="${pageLangAttr}" on an English page (want en)`);
      if (ogLocale !== 'en_US') add('error', rel, `og:locale is "${ogLocale}" on an English page (want en_US)`);
      if (ogUrl && ogUrl !== canonical) add('error', rel, `og:url (${ogUrl}) is not the canonical (${canonical})`);
    }

    // The EN / 中文 control must be two real links to the two page sets — never a DOM swap, never the
    // homepage. They are root-relative, so the same pair works on any host the site is served from. The
    // hand-written support pages carry the control twice (desktop + mobile nav), so an even count >= 2 is
    // expected; what matters is that every link points at the right language's version of THIS page.
    const paths = relToPaths(rel);
    const switcher = [...html.matchAll(/<a[^>]*data-lang="([^"]*)"[^>]*>/g)];
    if (switcher.length < 2 || switcher.length % 2 !== 0) {
      add('error', rel, `language switch has ${switcher.length} links (want an even number >= 2)`);
    }
    for (const [tag, side] of switcher) {
      const href = (tag.match(/href="([^"]*)"/) || [, ''])[1];
      if (href !== paths[side]) add('error', rel, `language switch ${side} link is ${href}, want ${paths[side]}`);
    }
  }

  for (const block of ld) {
    try {
      const parsed = JSON.parse(block[1]);
      if (!parsed || (Array.isArray(parsed) && !parsed.length)) add('warn', rel, 'empty JSON-LD block');
    } catch (err) {
      add('error', rel, `JSON-LD does not parse: ${err.message}`);
    }
  }

  if (/<img\b/.test(html)) {
    const missingAlt = [...html.matchAll(/<img\b[^>]*>/g)].filter((m) => !/\balt=/.test(m[0])).length;
    if (missingAlt) add('error', rel, `${missingAlt} <img> without alt`);
  }

  if (titles.has(title)) add('error', rel, `duplicate title with ${titles.get(title)}`);
  else titles.set(title, rel);
  if (desc && descriptions.has(desc)) add('error', rel, `duplicate meta description with ${descriptions.get(desc)}`);
  else if (desc) descriptions.set(desc, rel);

  // Chinese carries far more meaning per character, so the thin-content floor is lower on /zh/ pages.
  if (text.length < (zh ? 200 : 600) && !rel.startsWith('app/')) add('warn', rel, `thin content: ${text.length} chars of visible text`);
}

// ---- tool pages: keyword placement
for (const m of meta) {
  const p = pages.get(m.slug);
  if (!p) { add('error', m.slug, 'page was not built (missing from dist)'); continue; }
  const sel = selected[m.slug] || {};
  const kw = (sel.primary || m.kw || '').toLowerCase();
  if (!kw) continue;
  const low = (s) => s.toLowerCase();
  if (!low(p.title).includes(kw)) add('error', m.slug, `primary keyword "${kw}" missing from <title>`);
  if (!low(p.h1s[0] || '').includes(kw.split(' ')[0])) add('warn', m.slug, `H1 does not contain the keyword head "${kw.split(' ')[0]}"`);
  if (!low(p.desc).includes(kw)) add('warn', m.slug, `primary keyword "${kw}" missing from meta description`);
  const firstWords = low(p.text).split(/\s+/).slice(0, 120).join(' ');
  if (!firstWords.includes(kw)) add('warn', m.slug, `primary keyword "${kw}" missing from the first ~120 words`);
  const occurrences = (low(p.prose).match(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  const density = (occurrences * kw.split(' ').length) / Math.max(p.prose.split(/\s+/).length, 1);
  if (density > DENSITY_CEILING) add('warn', m.slug, `keyword density ${(density * 100).toFixed(1)}% in body copy — looks stuffed`);
  notes.push(`${m.slug}: "${kw}" ×${occurrences} body mentions (${(density * 100).toFixed(1)}% of ${p.prose.split(/\s+/).length} prose words)`);
}

// ---- internal link integrity
const resolveTarget = (href) => {
  const clean = href.split('#')[0].split('?')[0];
  if (!clean.startsWith('/')) return null;
  if (/^\/(src|assets)\//.test(clean)) return { asset: true };
  const asFile = path.join(DIST, clean.replace(/^\//, ''));
  if (clean.endsWith('/') || clean === '/') return { file: path.join(asFile, 'index.html') };
  if (fs.existsSync(asFile) && fs.statSync(asFile).isFile()) return { file: asFile };
  if (fs.existsSync(path.join(asFile, 'index.html'))) return { file: path.join(asFile, 'index.html') };
  return { file: asFile, missing: true };
};
let linkChecked = 0;
for (const [, page] of pages) {
  const hrefs = [...new Set([...page.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]))];
  for (const href of hrefs) {
    if (/^(https?:|mailto:|tel:|#|data:)/.test(href)) continue;
    const t = resolveTarget(href);
    if (!t || t.asset) continue;
    linkChecked++;
    if (t.missing || !fs.existsSync(t.file)) add('error', page.rel, `broken internal link: ${href}`);
  }
}
notes.push(`internal links checked: ${linkChecked}`);

// ---- Chinese pages: the primary Chinese term leads the <title> and the H1
for (const [slug, cn] of Object.entries(zhMeta.tools ?? {})) {
  const p = pages.get(`zh/${slug}`);
  if (!p) { add('error', `zh/${slug}`, 'Chinese page was not built (missing from dist)'); continue; }
  if (!cn.term) { add('error', `zh/${slug}`, 'no Chinese term in seo/zh.pages.json'); continue; }
  if (!p.title.includes(cn.term)) add('error', `zh/${slug}`, `Chinese term "${cn.term}" missing from <title>`);
  if (!(p.h1s[0] ?? '').includes(cn.term)) add('error', `zh/${slug}`, `Chinese term "${cn.term}" missing from the H1 (first screen)`);
  notes.push(`zh/${slug}: term "${cn.term}" ${p.desc.includes(cn.term) ? 'in' : 'not verbatim in'} the meta description`);
}

// ---- hreflang: en + zh-CN + x-default on EVERY page, and the pair must be reciprocal
const enTwin = (canonical) => {
  if (canonical === `${SITE_ROOT}/zh/`) return `${SITE_ROOT}/`;
  if (canonical.startsWith(`${SITE_ROOT}/zh/`)) {
    const dir = canonical.slice(`${SITE_ROOT}/zh/`.length).replace(/\/$/, '');
    return SUPPORT_DIRS.has(dir) ? `${SITE_ROOT}/${dir}.html` : `${SITE_ROOT}/${dir}/`;
  }
  return canonical;
};
const zhTwin = (canonical) => {
  if (canonical.startsWith(`${SITE_ROOT}/zh/`)) return canonical;
  if (canonical === `${SITE_ROOT}/`) return `${SITE_ROOT}/zh/`;
  const file = new RegExp(`^/([a-z0-9-]+)\\.html$`).exec(canonical.slice(SITE_ROOT.length));
  if (file && SUPPORT_DIRS.has(file[1])) return `${SITE_ROOT}/zh/${file[1]}/`;
  return `${SITE_ROOT}/zh${canonical.slice(SITE_ROOT.length)}`;
};
let reciprocal = 0;
for (const [canonical, entry] of hreflang) {
  const { rel, links } = entry;
  const expected = { en: enTwin(canonical), 'zh-CN': zhTwin(canonical), 'x-default': enTwin(canonical) };
  const found = Object.keys(links);
  if (found.length !== 3) add('error', rel, `hreflang: want en + zh-CN + x-default, found ${found.length} (${found.join(', ') || 'none'})`);
  for (const [lang, want] of Object.entries(expected)) {
    if (!links[lang]) add('error', rel, `hreflang: missing "${lang}" (should point at ${want})`);
    else if (links[lang] !== want) add('error', rel, `hreflang "${lang}" is ${links[lang]}, expected ${want}`);
  }
  // Reciprocity: the other language's page must exist AND point back at this one.
  const isZhPage = canonical.startsWith(`${SITE_ROOT}/zh/`);
  const partner = isZhPage ? expected.en : expected['zh-CN'];
  const partnerPage = hreflang.get(partner);
  if (!partnerPage) {
    add('error', rel, `hreflang: no ${isZhPage ? 'English' : 'Chinese'} twin built for ${partner}`);
    continue;
  }
  const back = isZhPage ? partnerPage.links['zh-CN'] : partnerPage.links.en;
  if (back !== canonical) add('error', rel, `hreflang is not reciprocal with ${partner}: it points at ${back}`);
  else reciprocal++;
}
notes.push(`hreflang: ${reciprocal} reciprocal pairs over ${hreflang.size} pages, each with all three tags`);

// ---- sitemap / robots / llms
for (const f of ['sitemap.xml', 'robots.txt', 'llms.txt']) {
  if (!fs.existsSync(path.join(DIST, f))) add('error', f, `missing from dist/ (is it in public/ or generated?)`);
}
if (fs.existsSync(path.join(DIST, 'sitemap.xml'))) {
  const sm = fs.readFileSync(path.join(DIST, 'sitemap.xml'), 'utf8');
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const SITE_NO_SLASH = cfg.siteUrl.replace(/\/$/, '');
  const expected = [
    '/', ...meta.map((m) => `/${m.slug}/`), ...SUPPORT_FILES.map((f) => `/${f}`),
    '/zh/', ...meta.map((m) => `/zh/${m.slug}/`), ...SUPPORT_FILES.map((f) => `/zh/${f.replace(/\.html$/, '')}/`),
  ];
  for (const e of expected) {
    if (!locs.some((l) => l.endsWith(`${SITE_NO_SLASH}${e}`) || l.endsWith(e))) add('error', 'sitemap.xml', `missing entry for ${e}`);
  }
  if (!/sitemaps\.org/.test(sm)) add('error', 'sitemap.xml', 'wrong sitemap namespace');
  if (!/Sitemap:/i.test(fs.readFileSync(path.join(DIST, 'robots.txt'), 'utf8'))) add('warn', 'robots.txt', 'no Sitemap: line');
  notes.push(`sitemap entries: ${locs.length} (expected ${expected.length})`);
}

// ---- report
const errors = problems.filter((p) => p.sev === 'error');
const warns = problems.filter((p) => p.sev === 'warn');
console.log(`pages scanned: ${pages.size} | tool pages: ${meta.length}`);
console.log(`errors: ${errors.length} | warnings: ${warns.length}\n`);
for (const p of errors) console.log(`  ERROR  ${p.page}: ${p.msg}`);
for (const p of warns.slice(0, 40)) console.log(`  warn   ${p.page}: ${p.msg}`);
if (warns.length > 40) console.log(`  … ${warns.length - 40} more warnings`);
if (process.env.SEO_CHECK_VERBOSE) for (const n of notes) console.log(`  note   ${n}`);
process.exit(errors.length ? 1 : 0);
