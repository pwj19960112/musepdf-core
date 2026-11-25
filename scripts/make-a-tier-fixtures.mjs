/**
 * Fixtures for the A-tier tools (pdf-to-text, extract-images, edit-bookmarks, bates-numbering).
 *
 *   node scripts/make-a-tier-fixtures.mjs
 *
 * Everything is generated here — no third-party document goes into the repository — and every page
 * carries a known string / image / outline entry so a verification run can assert on the CONTENT of
 * the output file rather than just "a file was produced".
 *
 *   test-fixtures/a-tier/text-3page.pdf     3 pages, one known sentence each, no images
 *   test-fixtures/a-tier/images-2page.pdf   2 pages: 3 embedded images, one of them repeated
 *   test-fixtures/a-tier/outline-4page.pdf  4 pages + a 2-entry PDF outline (Introduction, Appendix)
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { PDFDocument, StandardFonts, PDFName, PDFArray, PDFHexString, rgb } from 'pdf-lib';

const OUT = path.join(process.cwd(), 'test-fixtures', 'a-tier');
fs.mkdirSync(OUT, { recursive: true });

/** A PNG of one flat colour — a few hundred bytes, no dependency on Pillow here. */
function flatPng(width, height, [r, g, b]) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0; // no filter
    for (let x = 0; x < width; x++) {
      const p = row + 1 + x * 3;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) : crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/* 1. three pages of text ---------------------------------------------------------------- */

{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lines = ['Alpha page one', 'Bravo page two', 'Charlie page three'];
  for (const line of lines) {
    const page = doc.addPage([300, 400]);
    page.drawText(line, { x: 30, y: 340, size: 16, font });
    page.drawText('Total: 1,024', { x: 30, y: 300, size: 11, font });
  }
  doc.setTitle('A-tier text fixture');
  fs.writeFileSync(path.join(OUT, 'text-3page.pdf'), await doc.save());
}

/* 2. three images on two pages --------------------------------------------------------- */

{
  const doc = await PDFDocument.create();
  const red = await doc.embedPng(flatPng(120, 80, [220, 40, 40]));
  const blue = await doc.embedPng(flatPng(96, 96, [40, 60, 220]));
  const page1 = doc.addPage([400, 500]);
  page1.drawImage(red, { x: 40, y: 340, width: 120, height: 80 });
  page1.drawImage(blue, { x: 200, y: 340, width: 96, height: 96 });
  const page2 = doc.addPage([400, 500]);
  page2.drawImage(red, { x: 40, y: 340, width: 120, height: 80 }); // the same XObject, re-used
  fs.writeFileSync(path.join(OUT, 'images-2page.pdf'), await doc.save());
}

/* 3. four pages with an outline -------------------------------------------------------- */

{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = [];
  for (let i = 1; i <= 4; i++) {
    const page = doc.addPage([300, 400]);
    page.drawText(`Outline page ${i}`, { x: 30, y: 340, size: 14, font });
    pages.push(page);
  }

  // A hand-built /Outlines tree: catalog → Outlines → First … Next chain. Two entries, so a reader
  // that rebuilds the tree has something to rename, delete and append to.
  const ctx = doc.context;
  const outlineDict = ctx.obj({ Type: 'Outlines' });
  const outlineRef = ctx.register(outlineDict);
  const entries = [
    ['Introduction', 0],
    ['Appendix', 3],
  ];
  const refs = entries.map(([title, pageIndex]) => {
    const item = ctx.obj({
      Title: PDFHexString.fromText(title),
      Parent: outlineRef,
      Dest: ctx.obj([pages[pageIndex].ref, PDFName.of('Fit')]),
    });
    return ctx.register(item);
  });
  refs.forEach((ref, i) => {
    const dict = ctx.lookup(ref);
    if (i > 0) dict.set(PDFName.of('Prev'), refs[i - 1]);
    if (i < refs.length - 1) dict.set(PDFName.of('Next'), refs[i + 1]);
  });
  outlineDict.set(PDFName.of('First'), refs[0]);
  outlineDict.set(PDFName.of('Last'), refs[refs.length - 1]);
  outlineDict.set(PDFName.of('Count'), ctx.obj(refs.length));
  doc.catalog.set(PDFName.of('Outlines'), outlineRef);
  // /PageMode, because a reader only shows the panel when the document asks for it.
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));

  fs.writeFileSync(path.join(OUT, 'outline-4page.pdf'), await doc.save());
}

/* 4. a page for the BMP-ish sanity check of the PDF writer ------------------------------ */

{
  // One page with a coloured band, so a stamp is visibly placed (and the stamp test can also assert
  // that the page's own content survived).
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 300]);
  page.drawRectangle({ x: 0, y: 240, width: 400, height: 60, color: rgb(0.1, 0.2, 0.45) });
  page.drawText('Bates fixture page', { x: 30, y: 150, size: 14, font });
  fs.writeFileSync(path.join(OUT, 'stamp-1page.pdf'), await doc.save());
}

for (const file of fs.readdirSync(OUT).sort()) {
  console.log(`${file}  ${fs.statSync(path.join(OUT, file)).size} bytes`);
}
