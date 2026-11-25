/**
 * Builds test-fixtures/scan-only.pdf: a one-page PDF that is a bitmap and NOTHING else — no text
 * layer, no fonts. That is exactly the shape a flatbed scanner produces, and it is the case the
 * workbench's content default has to handle (`/edit-pdf/` cannot rewrite a page it cannot read).
 *
 *   node scripts/make-scan-fixture.mjs
 *
 * The image is generated in-process (a tiny PNG encoder, no image dependency) and embedded with
 * pdf-lib. The script re-parses its own output with pdf.js and FAILS unless the text layer is empty,
 * so the fixture cannot silently become a text PDF.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'test-fixtures', 'scan-only.pdf');

const WIDTH = 850;
const HEIGHT = 1100;

/* ------------------------------------------------------------------ tiny PNG encoder */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0; // filter: none
    rgb.copy(raw, rowStart + 1, y * width * 3, (y + 1) * width * 3);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ a scanned-looking page */

function scanPage() {
  const rgb = Buffer.alloc(WIDTH * HEIGHT * 3);
  // Deterministic noise, one value per 2x2 tile: a real scan is never a flat colour, and this is
  // what stops the page from compressing into something that looks nothing like a scan. Coarse tiles
  // (not per-pixel) keep the fixture small enough to upload quickly in the browser tests.
  const tileW = Math.ceil(WIDTH / 2);
  const tileH = Math.ceil(HEIGHT / 2);
  const noise = new Int8Array(tileW * tileH);
  let seed = 12345;
  for (let i = 0; i < noise.length; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    noise[i] = (seed % 24) - 12;
  }

  for (let y = 0; y < HEIGHT; y += 1) {
    const ty = (y >> 1) * tileW;
    for (let x = 0; x < WIDTH; x += 1) {
      const o = (y * WIDTH + x) * 3;
      // "Text": rows of dark bars inside the page margins.
      const inMargin = x > 70 && x < WIDTH - 70 && y > 110 && y < HEIGHT - 110;
      const bar = inMargin && y % 44 < 13 && (x * 7 + y * 13) % 23 !== 0;
      const base = bar ? 38 : 244;
      const v = Math.max(0, Math.min(255, base + noise[ty + (x >> 1)]));
      rgb[o] = v;
      rgb[o + 1] = v;
      rgb[o + 2] = v;
    }
  }
  return rgb;
}

/* ---------------------------------------------------------------------------------- build */

const png = encodePng(WIDTH, HEIGHT, scanPage());

const pdf = await PDFDocument.create();
pdf.setTitle('');
// Fixed dates so regenerating the fixture does not churn the committed bytes.
pdf.setCreationDate(new Date('2026-01-01T00:00:00Z'));
pdf.setModificationDate(new Date('2026-01-01T00:00:00Z'));
const image = await pdf.embedPng(png);
const page = pdf.addPage([612, 792]);
page.drawImage(image, { x: 0, y: 0, width: 612, height: 792 });

const bytes = await pdf.save();
fs.writeFileSync(OUT, bytes);

/* ------------------------------------------------------- self-check: really no text layer */

const legacy = await import('pdfjs-dist/legacy/build/pdf.mjs');
const doc = await legacy.getDocument({ data: new Uint8Array(fs.readFileSync(OUT)), useSystemFonts: false })
  .promise;
let items = 0;
for (let i = 1; i <= doc.numPages; i += 1) {
  const content = await (await doc.getPage(i)).getTextContent();
  items += content.items.length;
}

console.log(`wrote ${path.relative(ROOT, OUT)} — ${(bytes.length / 1024).toFixed(0)} KB, ${doc.numPages} page(s), ${items} text item(s)`);
if (items !== 0) {
  console.error('FAIL: the fixture has a text layer; it is supposed to be a scan.');
  process.exit(1);
}
console.log('OK: no text layer (scan case).');
