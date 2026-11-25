/**
 * Re-parses a PDF with pdf.js and asserts the given strings are extractable from its text layer.
 *
 *   node scripts/check-editor-export.mjs <file.pdf> "expected string" ["another" ...]
 *
 * Used to verify the /edit-pdf/ round trip: upload -> edit a run -> export -> the new text must come
 * back out of the exported bytes, not just look right on screen. Exit code 1 when a string is missing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [file, ...expected] = process.argv.slice(2);
if (!file) {
    console.error('usage: node scripts/check-editor-export.mjs <file.pdf> "expected string" [...]');
    process.exit(2);
}

const pdfjs = await import(
    pathToFileURL(path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href
);

const data = new Uint8Array(fs.readFileSync(file));
const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;

const pages = [];
for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((it) => it.str).join(''));
}

const text = pages.join('\n');
console.log(`file: ${file}`);
console.log(`pages: ${doc.numPages}`);
console.log('--- extracted text ---');
console.log(text);
console.log('--- assertions ---');

let failed = 0;
for (const want of expected) {
    const ok = text.includes(want);
    if (!ok) failed++;
    console.log(`${ok ? 'FOUND    ' : 'MISSING  '} ${JSON.stringify(want)}`);
}
process.exit(failed ? 1 : 0);
