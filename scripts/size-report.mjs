/**
 * First-load size report.
 *
 *   node scripts/size-report.mjs              # all pages
 *   node scripts/size-report.mjs merge-pdf    # one page
 *
 * For every generated page it walks the real chunk graph in dist/ (static imports of the entry chunk,
 * plus the tool's own lazily-imported chunk) and reports raw and gzip bytes — the honest budget for a
 * visitor, independent of caching quirks in a browser's resource timings.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const ASSETS = path.join(DIST, 'assets');

const gzipSize = (file) => zlib.gzipSync(fs.readFileSync(file), { level: 6 }).length;
const sizeOf = (file) => fs.statSync(file).size;
const kb = (n) => `${(n / 1024).toFixed(1)}KB`;

/** Static + dynamic imports declared by a built chunk. */
function importsOf(chunk) {
  const code = fs.readFileSync(chunk, 'utf8');
  const statics = [...code.matchAll(/(?:^|[;\s])import\s*(?:[^"'`]*?from\s*)?["'](\.\/[^"']+\.js)["']/g)].map((m) => m[1]);
  const dynamics = [...code.matchAll(/import\(\s*["'](\.\/[^"']+\.js)["']\s*\)/g)].map((m) => m[1]);
  return { statics: [...new Set(statics)], dynamics: [...new Set(dynamics)] };
}

const resolveFrom = (chunk, rel) => path.resolve(path.dirname(chunk), rel);

function walk(startChunks) {
  const seen = new Set();
  const queue = [...startChunks];
  while (queue.length) {
    const chunk = queue.shift();
    if (!chunk || seen.has(chunk) || !fs.existsSync(chunk)) continue;
    seen.add(chunk);
    const { statics } = importsOf(chunk);
    for (const rel of statics) queue.push(resolveFrom(chunk, rel));
  }
  return [...seen];
}

function entryChunkFor(html) {
  const scripts = [...html.matchAll(/<script type="module"[^>]*src="\/assets\/([^"]+)"/g)].map((m) => m[1]);
  return scripts.map((s) => path.join(ASSETS, s));
}

function cssFor(html) {
  return [...html.matchAll(/href="\/assets\/([^"]+\.css)"/g)].map((m) => path.join(ASSETS, m[1]));
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'seo', 'pages.manifest.json'), 'utf8')).inputs;
const only = process.argv[2];
const rows = [];

for (const [name, file] of Object.entries(manifest)) {
  if (only && name !== only && file !== only) continue;
  const abs = path.join(DIST, file);
  if (!fs.existsSync(abs)) continue;
  const html = fs.readFileSync(abs, 'utf8');
  const toolId = (html.match(/data-tool="([a-z0-9-]+)"/) || [])[1];

  const eager = walk(entryChunkFor(html));
  // The tool chunk is fetched as soon as the page mounts its tool. It is reached through a dynamic-import
  // table whose own chunk name is an implementation detail (the `landing` chunk today), so collect every
  // chunk's import() targets instead of hard-coding one file name.
  let toolChunks = [];
  if (toolId) {
    const dynamics = fs.readdirSync(ASSETS)
      .filter((f) => f.endsWith('.js'))
      .flatMap((f) => importsOf(path.join(ASSETS, f)).dynamics);
    const match = [...new Set(dynamics)]
      .map((rel) => path.basename(rel).replace(/\.js$/, ''))
      .find((base) => base === toolId || base.startsWith(`${toolId}-`));
    const exact = match && fs.readdirSync(ASSETS).find((f) => f.startsWith(`${match}-`) || f.replace(/\.js$/, '') === match);
    if (exact) toolChunks = walk([path.join(ASSETS, exact)]);
  }

  const jsFiles = [...new Set([...eager, ...toolChunks])];
  const cssFiles = cssFor(html);
  const jsRaw = jsFiles.reduce((a, f) => a + sizeOf(f), 0);
  const jsGz = jsFiles.reduce((a, f) => a + gzipSize(f), 0);
  const cssRaw = cssFiles.reduce((a, f) => a + sizeOf(f), 0);
  const cssGz = cssFiles.reduce((a, f) => a + gzipSize(f), 0);
  rows.push({ name, file, toolId, htmlKB: sizeOf(abs) / 1024, jsRaw, jsGz, cssRaw, cssGz, chunks: jsFiles.length });
}

rows.sort((a, b) => b.jsGz - a.jsGz);
console.log(`pages: ${rows.length}\n`);
console.log('page'.padEnd(26) + 'tool'.padEnd(18) + 'html'.padStart(8) + 'js raw'.padStart(11) + 'js gzip'.padStart(10) + 'css gzip'.padStart(10) + 'chunks'.padStart(8));
for (const r of rows.slice(0, 12)) {
  console.log(r.name.padEnd(26) + (r.toolId || '-').padEnd(18) + kb(r.htmlKB * 1024).padStart(8) +
    kb(r.jsRaw).padStart(11) + kb(r.jsGz).padStart(10) + kb(r.cssGz).padStart(10) + String(r.chunks).padStart(8));
}
if (rows.length > 12) console.log(`… ${rows.length - 12} more pages (lightest: ${kb(rows[rows.length - 1].jsGz)} js gzip)`);
const sum = (key) => rows.reduce((a, r) => a + r[key], 0);
console.log(`\nmedian js gzip: ${kb(rows[Math.floor(rows.length / 2)].jsGz)} | max: ${kb(rows[0].jsGz)} (${rows[0].name}) | min: ${kb(rows[rows.length - 1].jsGz)} (${rows[rows.length - 1].name})`);
console.log(`average per page: js ${kb(sum('jsRaw') / rows.length)} raw / ${kb(sum('jsGz') / rows.length)} gzip, css ${kb(sum('cssGz') / rows.length)} gzip`);
