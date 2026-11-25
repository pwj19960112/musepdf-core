/**
 * Independent check of an editor export: extract the text layer with pdf.js and report exactly what the
 * file contains. Deliberately does not trust the editor's own status text.
 *
 *   node scripts/verify-editor-export.mjs test-fixtures/exported-latin-and-cjk.pdf "needle one" "needle two"
 */
import fs from 'node:fs';
import path from 'node:path';

const [, , file, ...needles] = process.argv;
if (!file) {
  console.error('usage: node scripts/verify-editor-export.mjs <pdf> [needle ...]');
  process.exit(2);
}

const legacy = await import('pdfjs-dist/legacy/build/pdf.mjs');
const raw = fs.readFileSync(file);
const bytes = new Uint8Array(raw);
const byteLength = bytes.length; // pdf.js transfers the buffer, so capture the size first
const doc = await legacy.getDocument({ data: bytes, useSystemFonts: false }).promise;

console.log(`file: ${path.relative(process.cwd(), file)}  (${(byteLength / 1024).toFixed(0)} KB, ${doc.numPages} page(s))`);
const perPage = [];
for (let i = 1; i <= doc.numPages; i += 1) {
  const page = await doc.getPage(i);
  const content = await page.getTextContent();
  const text = content.items.map((item) => item.str).join('|');
  perPage.push(text);
  console.log(`  page ${i}: ${text.length > 300 ? `${text.slice(0, 300)}…` : text}`);
}

const all = perPage.join('\n');
// pdf.js emits one item per word and we join pages with "|", so compare the separator-free, gap-free form too
const flat = perPage.join('').replace(/[\s|]+/g, '');
let missing = 0;
for (const needle of needles) {
  const hit = all.includes(needle) || flat.includes(needle.replace(/[\s|]+/g, ''));
  if (!hit) missing += 1;
  console.log(`${hit ? 'FOUND  ' : 'MISSING'} ${needle}`);
}
console.log(`\nneedles: ${needles.length} | missing: ${missing}`);
process.exit(missing ? 1 : 0);
