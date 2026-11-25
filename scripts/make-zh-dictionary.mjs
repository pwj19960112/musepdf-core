/**
 * Builds public/i18n/zh.json — the dictionary `src/js/i18n/init.ts` fetches the first time a visitor
 * switches to 中文 (and for a Chinese-first visitor, at boot). It is the ONLY writer of that file.
 *
 *   node scripts/make-zh-dictionary.mjs              # after scripts/generate-seo-pages.mjs
 *   node scripts/make-zh-dictionary.mjs --dir dist   # audit the built site instead of the source pages
 *   node scripts/make-zh-dictionary.mjs --check      # report only; exit 1 when a string is untranslated
 *
 * WHY AN EXTRACTOR, NOT A HAND-WRITTEN LIST
 * -----------------------------------------
 * The runtime swaps copy by matching the *exact* English text that is on the page, so a key that drifts
 * by one character silently stops translating. This script therefore walks the real HTML (the generated
 * pages by default, `dist/**\/*.html` with --dir), takes every text node and every visible attribute,
 * and refuses to pass when one of them has no Chinese. The English → 中文 values come from two places:
 *
 *   seo/i18n.pairs.json    what scripts/generate-seo-pages.mjs paired at emission (the 59 tool pages,
 *                          the homepage, the footer, the app shell alerts).
 *   seo/i18n.zh.json       the hand-authored source: chrome, the support pages' copy, runtime strings,
 *                          and the list of English strings that are deliberately left alone.
 *
 * The output is one JSON object: { strings: {english: 中文}, attrs: {...} }. Nothing else reads it, and
 * it is never imported by a bundler entry — it is a static file, fetched only after a switch to 中文.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argValue = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1] ?? null;
};
const CHECK_ONLY = args.includes('--check');
const DIR_OVERRIDE = argValue('--dir');
const LIMIT = 40;

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

/** Attributes the runtime rewrites (must stay in sync with ATTRS in src/js/i18n/init.ts). */
const ATTRS = ['placeholder', 'aria-label', 'title'];
/** Sub-trees and elements the runtime never touches. */
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'CODE', 'PRE']);

/* ------------------------------------------------------------------ 1. extraction */

/** Every English string the page carries as a standalone text node or as one of the visible attrs. */
function extractFromHtml(html, collect) {
  const { document } = new JSDOM(html).window;
  const root = document.body ?? document.documentElement;
  if (!root) return;
  const walker = document.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent) continue;
    let skipped = false;
    for (let el = parent; el; el = el.parentElement) {
      if (SKIP_TAGS.has(el.tagName)) {
        skipped = true;
        break;
      }
      if (el.hasAttribute('data-i18n-skip')) {
        skipped = true;
        break;
      }
    }
    if (skipped) continue;
    const key = norm(node.data);
    if (key) collect(key, 'text');
  }
  for (const el of root.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(','))) {
    if (el.closest('[data-i18n-skip]')) continue;
    for (const attr of ATTRS) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      const key = norm(value);
      if (key) collect(key, `attr:${attr}`);
    }
  }
}

/**
 * The pages `vite build` turns into the site: the homepage, every tool slug, support pages.
 *
 * The pre-rendered `/zh/**` pages are deliberately NOT here. The dictionary is keyed by the ENGLISH
 * string that appears on an English page, so extracting from a page that is already Chinese would only
 * ask for a Chinese → Chinese entry (and report every Chinese sentence as untranslated). Their copy is
 * translated at build time by scripts/generate-seo-pages.mjs, which is the thing to fix when a `/zh/`
 * page shows English.
 */
function sourcePageFiles() {
  const files = ['index.html'];
  const manifest = exists('seo/pages.manifest.json') ? readJson('seo/pages.manifest.json') : null;
  for (const input of Object.values(manifest?.inputs ?? {})) files.push(input);
  for (const page of ['about', 'faq', 'contact', 'privacy', 'terms']) {
    if (exists(`${page}.html`)) files.push(`${page}.html`);
  }
  return files.filter((f, i) => files.indexOf(f) === i && !/^zh\//.test(f) && exists(f));
}

function builtPageFiles() {
  return fs.readdirSync(path.join(ROOT, 'dist'), { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => rel(path.join(entry.parentPath, entry.name)))
    .filter((file) => !file.startsWith('zh/'))
    .sort();
}

/* ------------------------------------------------------------------ 2. runtime + workbench */

/** The values of `RUNTIME_STRINGS` — read out of the TypeScript file so there is one definition, not two. */
function runtimeStrings() {
  const source = fs.readFileSync(path.join(ROOT, 'src/js/i18n/runtime-strings.ts'), 'utf8');
  const start = source.indexOf('{', source.indexOf('export const RUNTIME_STRINGS'));
  const end = source.lastIndexOf('}', source.indexOf('as const', start));
  // The object literal is plain JavaScript (string values only), so it can be evaluated as data.
  return Object.values(Function(`"use strict"; return (${source.slice(start, end + 1)});`)());
}
const RUNTIME_STRINGS = runtimeStrings();

/** Quoted-string pairs (`label: "Text", zhLabel: "中文"`) out of the workbench island's own sources. */
function workbenchPairs() {
  const pairs = [];
  const decode = (raw) => JSON.parse(raw);

  const registryPath = path.join(ROOT, 'src/js/editor/stirling/toolRegistry.ts');
  const registry = fs.existsSync(registryPath) ? fs.readFileSync(registryPath, 'utf8') : '';
  const entry = /\{[^{}]*?label:\s*("(?:[^"\\]|\\.)*")[^{}]*?zhLabel:\s*("(?:[^"\\]|\\.)*")[^{}]*?\}/gs;
  for (const block of registry.matchAll(entry)) {
    const chunk = block[0];
    const en = decode(block[1]);
    const zh = decode(block[2]);
    pairs.push({ en, zh, where: 'workbench label' });
    const desc = chunk.match(/description:\s*("(?:[^"\\]|\\.)*")/);
    const zhDesc = chunk.match(/zhDescription:\s*("(?:[^"\\]|\\.)*")/);
    if (desc && zhDesc) pairs.push({ en: decode(desc[1]), zh: decode(zhDesc[1]), where: 'workbench description' });
  }

  // `tw(lang, "English", "中文")` — the island's inline bilingual strings (takeover bar, scan notice,
  // sidebar). Deliberately NOT every island file: a short label from a workbench panel ("Page",
  // "Format", "Custom") would become a dictionary key for the PAGE swapper too and could hit an
  // unrelated text node on a real page. Only files whose copy is exclusive to the island go here.
  for (const file of ['TakeoverBar.tsx', 'ScanNotice.tsx', 'ScanOnlyNotice.tsx', 'WorkbenchSidebar.tsx']) {
    const abs = path.join(ROOT, 'src/js/editor/stirling', file);
    if (!fs.existsSync(abs)) continue;
    const source = fs.readFileSync(abs, 'utf8');
    for (const call of source.matchAll(/tw\(\s*lang\s*,\s*("(?:[^"\\]|\\.)*")\s*,\s*("(?:[^"\\]|\\.)*")\s*,?\s*\)/gs)) {
      pairs.push({ en: decode(call[1]), zh: decode(call[2]), where: file });
    }
  }
  return pairs;
}

/* ------------------------------------------------------------------ 3. merge */

const ZH = readJson('seo/i18n.zh.json');
const AUTHORED = ZH.strings ?? {};
const AUTHORED_ATTRS = ZH.attrs ?? {};
const RUNTIME_ZH = ZH.runtime ?? {};
const KEEP_ENGLISH = new Set(ZH.keepEnglish ?? []);

/**
 * Copy the tool TEMPLATES inject at runtime (src/js/ui.ts `toolTemplates` → #tool-content). It is not
 * in any generated .html, so the page extraction below cannot see it — but the runtime swapper does,
 * keyed by the same whitespace-normalised English text. Kept in its own file so the two populations
 * (generated markup vs. runtime-injected markup) stay distinguishable.
 */
const TOOL_UI = exists('seo/i18n.tools.json') ? readJson('seo/i18n.tools.json').strings ?? {} : {};

if (!exists('seo/i18n.pairs.json')) {
  console.error('seo/i18n.pairs.json is missing — run `node scripts/generate-seo-pages.mjs` first.');
  process.exit(2);
}
const PAIRS = readJson('seo/i18n.pairs.json');

const strings = {};
const attrs = {};
const conflicts = [];
/** Hand-authored copy wins, but a disagreement with the generator's pairing is a bug, not a preference. */
function add(map, key, value, source) {
  if (!key || !value) return;
  const previous = map[key];
  if (previous !== undefined && previous !== value) {
    conflicts.push({ key, had: previous, now: value, source });
    return;
  }
  map[key] = value;
}
for (const [key, value] of Object.entries(PAIRS.strings)) add(strings, key, value, 'seo/i18n.pairs.json');
for (const [key, value] of Object.entries(PAIRS.attrs)) add(attrs, key, value, 'seo/i18n.pairs.json');
for (const [key, value] of Object.entries(AUTHORED)) add(strings, key, value, 'seo/i18n.zh.json strings');
for (const [key, value] of Object.entries(AUTHORED_ATTRS)) add(attrs, key, value, 'seo/i18n.zh.json attrs');
for (const [key, value] of Object.entries(TOOL_UI)) add(strings, key, value, 'seo/i18n.tools.json');

const runtimeMissing = [];
let runtimePairs = 0;
for (const en of RUNTIME_STRINGS) {
  const zh = RUNTIME_ZH[en];
  if (!zh) {
    runtimeMissing.push(en);
    continue;
  }
  add(strings, en, zh, 'seo/i18n.zh.json runtime');
  runtimePairs++;
}

const workbenchMissing = [];
const workbench = [];
for (const { en, zh, where } of workbenchPairs()) {
  if (!zh || !en) {
    workbenchMissing.push(`${where}: ${en}`);
    continue;
  }
  workbench.push(en);
  add(strings, en, zh, `workbench (${where})`);
}

/* ------------------------------------------------------------------ 4. audit against the real HTML */

const files = DIR_OVERRIDE ? builtPageFiles().filter((f) => f.startsWith(`${DIR_OVERRIDE.replace(/^\.?\//, '')}/`)) : sourcePageFiles();
const extracted = new Map(); // key → Set(where)
const extractedAttrs = new Map();
let textNodes = 0;
for (const file of files) {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  extractFromHtml(html, (key, kind) => {
    const target = kind === 'text' ? extracted : extractedAttrs;
    if (!target.has(key)) target.set(key, new Set());
    target.get(key).add(file);
    if (kind === 'text') textNodes++;
  });
}

const missingText = [...extracted.keys()].filter((key) => !strings[key] && !KEEP_ENGLISH.has(key));
const missingAttrs = [...extractedAttrs.keys()].filter((key) => !attrs[key] && !KEEP_ENGLISH.has(key));
const kept = [...extracted.keys(), ...extractedAttrs.keys()].filter((key) => KEEP_ENGLISH.has(key));
const unused = Object.keys(strings).filter((key) => !extracted.has(key) && !extractedAttrs.has(key) && !workbench.includes(key) && !RUNTIME_STRINGS.includes(key) && !(key in TOOL_UI));

/* ------------------------------------------------------------------ 5. output */

const payload = {
  $comment:
    'Generated by scripts/make-zh-dictionary.mjs from seo/i18n.pairs.json + seo/i18n.zh.json — do not edit. ' +
    'Keyed by the exact English string that is on the page; values are 简体中文.',
  lang: 'zh',
  generated: new Date().toISOString(),
  counts: {
    strings: Object.keys(strings).length,
    attrs: Object.keys(attrs).length,
    extracted: extracted.size,
    keptEnglish: kept.length,
    untranslated: missingText.length + missingAttrs.length,
  },
  strings,
  attrs,
};

const report = [];
report.push(`pages scanned: ${files.length}${DIR_OVERRIDE ? ` (--dir ${DIR_OVERRIDE})` : ''}`);
report.push(`text nodes seen: ${textNodes}`);
report.push(`generator pairs: ${Object.keys(PAIRS.strings).length} strings / ${Object.keys(PAIRS.attrs).length} attrs`);
report.push(`runtime pairs: ${runtimePairs} (untracked: ${runtimeMissing.length})`);
report.push(`tool-template pairs: ${Object.keys(TOOL_UI).length}`);
report.push(`workbench pairs: ${workbench.length} (empty: ${workbenchMissing.length})`);
report.push(`dictionary: ${Object.keys(strings).length} strings, ${Object.keys(attrs).length} attrs, ${Buffer.byteLength(JSON.stringify(payload))} bytes`);
report.push(`extracted and covered: ${extracted.size - missingText.length - kept.length} text / ${extractedAttrs.size - missingAttrs.length} attrs`);
report.push(`deliberately English: ${kept.length}`);
report.push(`untranslated: ${missingText.length + missingAttrs.length}`);
if (unused.length) report.push(`not seen in this extraction: ${unused.length} (chunks of pages not scanned, or dead entries)`);
if (conflicts.length) report.push(`CONFLICTS: ${conflicts.length}`);
console.log(report.join('\n'));

const show = (label, list) => {
  if (!list.length) return;
  console.log(`\n${label} (${list.length}${list.length > LIMIT ? `, first ${LIMIT}` : ''}):`);
  for (const item of list.slice(0, LIMIT)) console.log(`  - ${item}`);
};
show('UNTRANSLATED text', missingText);
show('UNTRANSLATED attrs', missingAttrs.map((k) => `attr: ${k}`));
show('runtime strings without Chinese', runtimeMissing);
show('workbench strings without Chinese', workbenchMissing);
show('CONFLICTS', conflicts.map((c) => `${c.key} → "${c.had}" vs "${c.now}" (${c.source})`));

if (CHECK_ONLY) {
  const failed = missingText.length + missingAttrs.length + runtimeMissing.length + workbenchMissing.length + conflicts.length;
  console.log(failed ? `\ncheck FAILED: ${failed} problem(s)` : '\ncheck OK: every extracted English string has 简体中文');
  process.exit(failed ? 1 : 0);
}

const out = path.join(ROOT, 'public/i18n/zh.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(payload, null, 2) + '\n', 'utf8');
console.log(`\nwrote ${rel(out)}`);
if (DIR_OVERRIDE) {
  const mirror = path.join(ROOT, 'dist/i18n/zh.json');
  if (fs.existsSync(path.dirname(mirror))) {
    fs.writeFileSync(mirror, JSON.stringify(payload) + '\n', 'utf8');
    console.log(`wrote ${rel(mirror)}`);
  }
}
