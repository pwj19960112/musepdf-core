/**
 * Real-browser functional check for the A-tier tools, over raw CDP.
 *
 *   "/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new \
 *     --remote-debugging-port=9335 --user-data-dir=<scratch>/cdp-a-tier \
 *     --no-first-run --no-proxy-server --disable-gpu --window-size=1400,900 about:blank &
 *   npx vite preview --port 4173 --strictPort &
 *   node scripts/verify-a-tier.mjs 9335            # every case
 *   node scripts/verify-a-tier.mjs 9335 pdf-to-text  # one case
 *
 * Each case uploads a fixture from test-fixtures/a-tier/ through the page's own file input, clicks the
 * page's own process button, captures the Blob the page hands to a download link, writes it to
 * .verify-a-tier/ and then inspects the FILE — text content, ZIP entries, the /Outlines tree, the
 * stamped numbers — so "the tool works" means the output is correct, not that a click happened.
 */
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import JSZip from 'jszip';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef } from 'pdf-lib';
import { Cdp } from './cdp-lib.mjs';

/** Extract the text layer of a PDF in Node (pdf.js legacy build, no worker) — used to read the stamps. */
async function pdfText(buffer) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), standardFontDataUrl: './node_modules/pdfjs-dist/standard_fonts/' }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        pages.push(content.items.map((item) => item.str).join(''));
    }
    return pages;
}

const PORT = process.argv[2] ?? '9335';
const ONLY = process.argv[3] ?? null;
const BASE = 'http://localhost:4173';
const FIX = path.join(process.cwd(), 'test-fixtures');
const OUT = path.join(process.cwd(), '.verify-a-tier');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok: Boolean(ok) });
    console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ` | ${detail}` : ''}`);
};

const HELPERS = `
window.__dl = { blobs: [], names: [] };
(() => {
  const create = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (b) => { window.__dl.blobs.push(b); return create(b); };
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { window.__dl.names.push(this.download); };
  window.__upload = (b64, name, type = 'application/pdf') => {
    const bin = atob(b64); const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const input = document.querySelector('#file-input');
    if (!input) return 'no-input';
    const dt = new DataTransfer();
    dt.items.add(new File([u], name, { type }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  };
  window.__uploadMany = (items) => {
    const input = document.querySelector('#file-input');
    if (!input) return 'no-input';
    const dt = new DataTransfer();
    for (const { b64, name, type } of items) {
      const bin = atob(b64); const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      dt.items.add(new File([u], name, { type: type || 'application/pdf' }));
    }
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  };
  window.__blobB64 = (i) => new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1]);
    fr.readAsDataURL(window.__dl.blobs[i]);
  });
})(); 'ok'`;

const cdp = await Cdp.attachPage(PORT);
await cdp.goto(`${BASE}/`);
await cdp.eval("localStorage.setItem('bentopdf.lang', 'en'); 'ok'");

const open = async (route) => {
    await cdp.goto(`${BASE}${route}`);
    await cdp.waitFor('!!document.querySelector("#file-input")', { label: 'file input' });
    await cdp.eval(HELPERS);
};

const upload = async (file) => {
    const b64 = fs.readFileSync(path.join(FIX, file)).toString('base64');
    const name = path.basename(file);
    const ok = await cdp.eval(`window.__upload(${JSON.stringify(b64)}, ${JSON.stringify(name)})`);
    if (ok !== 'ok') throw new Error(`upload failed: ${ok}`);
};

const uploadMany = async (files) => {
    const items = files.map((file) => ({ b64: fs.readFileSync(path.join(FIX, file)).toString('base64'), name: path.basename(file) }));
    const ok = await cdp.eval(`window.__uploadMany(${JSON.stringify(items)})`);
    if (ok !== 'ok') throw new Error(`upload failed: ${ok}`);
};

/** Click the page's process button and wait for the download Blob it produces. */
const runTool = async (label, { expect } = {}) => {
    const before = await cdp.eval('window.__dl.blobs.length');
    await cdp.click('#process-btn');
    await cdp.waitFor(
        `window.__dl.blobs.length > ${before} || !document.getElementById('alert-modal').classList.contains('hidden')`,
        { timeoutMs: expect === 'no-download' ? 6000 : 45000, label }
    );
    const state = await cdp.eval(`(() => ({
        blobs: window.__dl.blobs.length,
        names: window.__dl.names.slice(),
        alertOpen: !document.getElementById('alert-modal').classList.contains('hidden'),
        alertTitle: document.getElementById('alert-title').textContent,
        alertBody: document.getElementById('alert-message').textContent,
    }))()`);
    if (state.blobs > before) {
        const b64 = await cdp.eval(`window.__blobB64(${state.blobs - 1})`);
        const meta = await cdp.eval(`(() => { const b = window.__dl.blobs[${state.blobs - 1}]; return { type: b.type, size: b.size }; })()`);
        const out = path.join(OUT, state.names[state.names.length - 1] || 'download.bin');
        fs.writeFileSync(out, Buffer.from(b64, 'base64'));
        return { ...state, file: out, size: meta.size, type: meta.type };
    }
    return state;
};

const closeAlert = async () => {
    await cdp.eval("document.getElementById('alert-ok').click(); 'ok'");
};

/* ------------------------------------------------------------------ pdf-to-text */

async function pdfToText() {
    await open('/pdf-to-text/');
    await upload('a-tier/text-3page.pdf');
    await cdp.waitFor("!document.getElementById('pdf-to-text-options').classList.contains('hidden')", { label: 'options revealed' });
    const hiddenOptions = await cdp.eval("document.getElementById('pdf-to-text-options').classList.contains('hidden')");
    check('pdf-to-text: options panel appears after the file is chosen', hiddenOptions === false);

    const plain = await runTool('pdf-to-text run');
    check('pdf-to-text: produced a .txt file', /\.txt$/.test(plain.names.join(',')), plain.names.join(','));
    const text = fs.readFileSync(plain.file, 'utf8');
    check('pdf-to-text: text carries all three pages, in order',
        text.includes('Alpha page one') && text.includes('Bravo page two') && text.includes('Charlie page three')
        && text.indexOf('Alpha') < text.indexOf('Bravo') && text.indexOf('Bravo') < text.indexOf('Charlie'),
        JSON.stringify(text.slice(0, 80)));
    check('pdf-to-text: no page banners when the option is off', !/--- Page 1 ---/.test(text));

    // Option on → markers
    await cdp.eval("document.getElementById('pdf-to-text-markers').click(); 'ok'");
    const marked = await runTool('pdf-to-text markers');
    const markedText = fs.readFileSync(marked.file, 'utf8');
    check('pdf-to-text: page markers written when asked',
        markedText.includes('--- Page 1 ---') && markedText.includes('--- Page 3 ---') && markedText.includes('Alpha page one'),
        JSON.stringify(markedText.slice(0, 60)));

    // A scan: no text layer anywhere → a clear message and no file
    await open('/pdf-to-text/');
    await upload('scan-only.pdf');
    await cdp.waitFor("!document.getElementById('pdf-to-text-options').classList.contains('hidden')", { label: 'scan options' });
    const scan = await runTool('pdf-to-text scan', { expect: 'no-download' });
    check('pdf-to-text: a scan gets a "no text layer" message, not an empty file',
        scan.alertOpen && /No text layer found/.test(scan.alertTitle) && scan.blobs === 0,
        `${scan.alertTitle} / blobs=${scan.blobs}`);
    check('pdf-to-text: the message points at the OCR tool',
        /OCR PDF/.test(scan.alertBody), scan.alertBody.slice(0, 90));
    await closeAlert();
}

/* ---------------------------------------------------------------- extract-images */

async function extractImages() {
    await open('/extract-images/');
    await upload('a-tier/images-2page.pdf');
    await cdp.waitFor("!document.getElementById('extract-images-options').classList.contains('hidden')", { label: 'image options' });

    const run = await runTool('extract-images run');
    check('extract-images: produced a ZIP', /\.zip$/.test(run.names.join(',')), run.names.join(','));
    const zip = await JSZip.loadAsync(fs.readFileSync(run.file));
    const entries = Object.keys(zip.files).filter((name) => !zip.files[name].dir).sort();
    check('extract-images: one entry per DISTINCT embedded image (the repeated logo is deduped)',
        entries.length === 2, entries.join(','));
    check('extract-images: entries are named by page and index',
        entries.every((n) => /^p\d{2}-img\d{2}\.png$/.test(n)), entries.join(','));

    const first = await zip.file(entries[0]).async('nodebuffer');
    check('extract-images: the entry is a real PNG (magic bytes)', first.slice(0, 8).toString('hex') === '89504e470d0a1a0a', first.slice(0, 8).toString('hex'));
    // The fixture's images are 120x80 and 96x96: the PNG header carries the true size.
    const sizes = [];
    for (const name of entries) {
        const buf = await zip.file(name).async('nodebuffer');
        sizes.push(`${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`);
    }
    check('extract-images: output keeps the ORIGINAL image resolution',
        sizes.sort().join(',') === '120x80,96x96', sizes.join(','));

    const summary = await cdp.eval("document.querySelector('[data-image-summary]')?.textContent || ''");
    check('extract-images: the page reports what it extracted', /2 image\(s\) from 2 page\(s\)/.test(summary), summary);

    // JPG option: smaller file, white-flattened, still one entry per image.
    await cdp.eval("const s=document.getElementById('extract-images-format'); s.value='jpeg'; s.dispatchEvent(new Event('change')); 'ok'");
    const jpg = await runTool('extract-images jpeg');
    const jpgZip = await JSZip.loadAsync(fs.readFileSync(jpg.file));
    const jpgEntries = Object.keys(jpgZip.files).filter((n) => !jpgZip.files[n].dir);
    check('extract-images: JPG option switches the format', jpgEntries.every((n) => n.endsWith('.jpg')), jpgEntries.join(','));
}

/* ---------------------------------------------------------------- edit-bookmarks */

/** Read the /Outlines tree of a saved PDF straight out of the file. */
async function outlineOf(file) {
    const doc = await PDFDocument.load(new Uint8Array(fs.readFileSync(file)));
    const outlines = doc.context.lookup(doc.catalog.get(PDFName.of('Outlines')));
    if (!outlines) return [];
    const items = [];
    let node = outlines.get(PDFName.of('First'));
    node = node instanceof PDFRef ? doc.context.lookup(node) : node;
    let guard = 0;
    while (node && node.get && guard++ < 50) {
        const titleNode = doc.context.lookup(node.get(PDFName.of('Title')));
        const title = titleNode && titleNode.decodeText ? titleNode.decodeText() : String(titleNode);
        const dest = doc.context.lookup(node.get(PDFName.of('Dest')));
        let page = 0;
        if (dest instanceof PDFArray) {
            const ref = dest.get(0);
            page = doc.getPages().findIndex((p) => p.ref.toString() === ref.toString()) + 1;
        }
        items.push({ title, page });
        const next = node.get(PDFName.of('Next'));
        node = next ? doc.context.lookup(next) : null;
    }
    return items;
}

const rowTitles = () => cdp.eval("[...document.querySelectorAll('[data-bookmark-title]')].map(i => i.value)");
const rowPages = () => cdp.eval("[...document.querySelectorAll('[data-bookmark-page]')].map(i => i.value)");

async function editBookmarks() {
    await open('/edit-bookmarks/');
    await upload('a-tier/outline-4page.pdf');
    await cdp.waitFor("!document.getElementById('bookmarks-options').classList.contains('hidden')", { label: 'bookmark options' });
    await cdp.waitFor("document.querySelectorAll('[data-bookmark-title]').length === 2", { label: 'two rows' });

    check('edit-bookmarks: existing outline is listed with its target pages',
        JSON.stringify(await rowTitles()) === JSON.stringify(['Introduction', 'Appendix'])
        && JSON.stringify(await rowPages()) === JSON.stringify(['1', '4']),
        `${(await rowTitles()).join(',')} @ ${(await rowPages()).join(',')}`);

    // Rename the first, retarget it to page 2, delete the second, add a new one.
    await cdp.eval(`(() => {
        const t = document.querySelectorAll('[data-bookmark-title]')[0];
        t.value = 'Chapter One';
        t.dispatchEvent(new Event('input', { bubbles: true }));
        const p = document.querySelectorAll('[data-bookmark-page]')[0];
        p.value = '2';
        p.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelectorAll('[data-bookmark-delete]')[1].click();
        return 'ok';
    })()`);
    await cdp.waitFor("document.querySelectorAll('[data-bookmark-title]').length === 1", { label: 'row deleted' });
    await cdp.click('#bookmark-add');
    await cdp.waitFor("document.querySelectorAll('[data-bookmark-title]').length === 2", { label: 'row added' });
    await cdp.eval(`(() => {
        const t = document.querySelectorAll('[data-bookmark-title]')[1];
        t.value = 'Notes';
        t.dispatchEvent(new Event('input', { bubbles: true }));
        const p = document.querySelectorAll('[data-bookmark-page]')[1];
        p.value = '3';
        p.dispatchEvent(new Event('input', { bubbles: true }));
        return 'ok';
    })()`);

    const run = await runTool('edit-bookmarks save');
    check('edit-bookmarks: saved a PDF', /\.pdf$/.test(run.names.join(',')), run.names.join(','));
    const outline = await outlineOf(run.file);
    check('edit-bookmarks: the saved outline carries the edits, in order',
        JSON.stringify(outline) === JSON.stringify([{ title: 'Chapter One', page: 2 }, { title: 'Notes', page: 3 }]),
        JSON.stringify(outline));

    const savedDoc = await PDFDocument.load(new Uint8Array(fs.readFileSync(run.file)));
    check('edit-bookmarks: the page count is untouched', savedDoc.getPageCount() === 4, String(savedDoc.getPageCount()));
}

/* ---------------------------------------------------------------- bates-numbering */

async function batesNumbering() {
    await open('/bates-numbering/');
    await uploadMany(['a-tier/text-3page.pdf', 'a-tier/stamp-1page.pdf']);
    await cdp.waitFor('!document.getElementById("process-btn").disabled', { label: 'bates ready' });
    await cdp.eval(`(() => {
        const set = (id, value) => { const el = document.getElementById(id); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };
        set('bates-prefix', 'ABC');
        set('bates-start', '1');
        set('bates-digits', '6');
        return 'ok';
    })()`);

    const run = await runTool('bates run');
    check('bates-numbering: several files come back as one ZIP', /\.zip$/.test(run.names.join(',')), run.names.join(','));
    const zip = await JSZip.loadAsync(fs.readFileSync(run.file));
    const entries = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
    check('bates-numbering: one stamped PDF per input file', entries.length === 2, entries.join(','));

    // Named lookups, not sort order: the counter follows the order files were ADDED (text-3page first).
    const byName = (suffix) => entries.find((n) => n.includes(suffix));
    const first = await pdfText(await zip.file(byName('text-3page-bates')).async('nodebuffer'));
    const second = await pdfText(await zip.file(byName('stamp-1page-bates')).async('nodebuffer'));
    check('bates-numbering: every page of the first file is stamped, starting at the start number',
        first.length === 3 && first[0].includes('ABC000001') && first[1].includes('ABC000002') && first[2].includes('ABC000003'),
        JSON.stringify(first));
    check('bates-numbering: the counter CONTINUES into the second file',
        second.length === 1 && second[0].includes('ABC000004'), JSON.stringify(second));
    check('bates-numbering: the original page text survives the stamp',
        first[0].includes('Alpha page one'), first[0]);

    // A different format: prefix + different digit count + a top position.
    await open('/bates-numbering/');
    await upload('a-tier/stamp-1page.pdf');
    await cdp.waitFor('!document.getElementById("process-btn").disabled', { label: 'bates single ready' });
    await cdp.eval(`(() => {
        const set = (id, value) => { const el = document.getElementById(id); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };
        set('bates-prefix', 'EX-');
        set('bates-start', '7');
        set('bates-digits', '3');
        set('bates-position', 'top-left');
        return 'ok';
    })()`);
    const single = await runTool('bates single');
    check('bates-numbering: a single file downloads as a PDF, not a ZIP', /\.pdf$/.test(single.names.join(',')), single.names.join(','));
    const singleText = await pdfText(fs.readFileSync(single.file));
    check('bates-numbering: prefix, start number and digits are honoured',
        singleText[0].includes('EX-007'), JSON.stringify(singleText));
}

/* ---------------------------------------------------------------- the Chinese twins */

/**
 * The Chinese pages are pre-rendered HTML, and the tool panels live in that HTML too, so their labels
 * must be Chinese BEFORE any script runs — and the tool must still work after the language switch.
 */
async function zhPages() {
    for (const slug of ['pdf-to-text', 'extract-images', 'edit-bookmarks', 'bates-numbering']) {
        await cdp.goto(`${BASE}/zh/${slug}/`);
        await cdp.waitFor('!!document.querySelector("#file-input")', { label: `zh ${slug} panel` });
        const panel = await cdp.eval("document.getElementById('tool-content').innerText");
        const cjk = (panel.match(/[\u3400-\u9FFF]/g) || []).length;
        check(`zh/${slug}: the tool panel is rendered in Chinese`, cjk >= 15, `${cjk} CJK chars`);
        const h1 = await cdp.eval('document.querySelector("h1").textContent');
        check(`zh/${slug}: the h1 is Chinese`, /[\u3400-\u9FFF]/.test(h1), h1.slice(0, 40));
    }

    // …and the tool still runs on the Chinese page.
    await open('/zh/pdf-to-text/');
    await upload('a-tier/text-3page.pdf');
    await cdp.waitFor("!document.getElementById('pdf-to-text-options').classList.contains('hidden')", { label: 'zh options' });
    const run = await runTool('zh pdf-to-text');
    const text = fs.readFileSync(run.file, 'utf8');
    check('zh/pdf-to-text: extracting text works on the Chinese page', text.includes('Alpha page one'), JSON.stringify(text.slice(0, 40)));
}

/* ---------------------------------------------------------------- existing tools still work */

/**
 * The panel markup of the four tools above ships as static HTML, and the icon set was cut down to a
 * subset — both touch code every other tool page runs through. This walks a spread of the EXISTING
 * tools (single-file, multi-file, template-driven, workbench) and asserts their panels still render,
 * their icons are converted, and their options appear after a file is chosen.
 */
async function regression() {
    const cases = [
        { slug: 'merge-pdf', options: 'merge-options' },
        { slug: 'split-pdf', options: 'split-options' },
        { slug: 'add-page-numbers-to-pdf', options: 'pagenum-options' },
        { slug: 'compress-pdf', options: 'compress-options' },
        { slug: 'pdf-to-word', options: 'pdf-to-word-options' },
        { slug: 'rotate-pdf', options: 'page-rotator' },
        { slug: 'organize-pdf', options: 'page-organizer' },
    ];
    for (const { slug, options } of cases) {
        await open(`/${slug}/`);
        const state = await cdp.eval(`(() => {
            const panel = document.getElementById('tool-content');
            // lucide REPLACES <i data-lucide> with <svg data-lucide>, so a leftover <i> (or any
            // non-svg element still carrying the attribute) is the thing that indicates a miss.
            return {
                text: panel.innerText.trim().length,
                leftoverIcons: panel.querySelectorAll('[data-lucide]:not(svg)').length,
                svgs: panel.querySelectorAll('svg[data-lucide]').length,
            };
        })()`);
        check(`regression ${slug}: panel renders from the template map`, state.text > 40, `${state.text} chars`);
        check(`regression ${slug}: its icons were converted (svg[data-lucide], no placeholder left)`,
            state.leftoverIcons === 0 && state.svgs > 0, `left=${state.leftoverIcons} svg=${state.svgs}`);

        await upload('a-tier/text-3page.pdf');
        const revealed = await cdp.waitFor(`(() => { const el = document.getElementById('${options}'); return el && !el.classList.contains('hidden'); })()`, {
            timeoutMs: 15000,
            label: `${slug} options`,
        }).then(() => true).catch(() => false);
        check(`regression ${slug}: choosing a file opens its options`, revealed, options);
    }

    // A workbench entry still mounts the editor island (it is the last branch in the dispatch chain).
    await open('/edit-pdf/');
    await upload('a-tier/text-3page.pdf');
    const mounted = await cdp.waitFor('document.querySelectorAll("[data-app-shell-for], #tool-content *").length > 3', { timeoutMs: 25000, label: 'workbench mount' })
        .then(() => true).catch(() => false);
    check('regression edit-pdf: the workbench still mounts after a file is chosen', mounted);
}

/* ------------------------------------------------------------------ runner */

const cases = { 'pdf-to-text': pdfToText, 'extract-images': extractImages, 'edit-bookmarks': editBookmarks, 'bates-numbering': batesNumbering, zh: zhPages, regression };

try {
    for (const [name, fn] of Object.entries(cases)) {
        if (ONLY && ONLY !== name) continue;
        console.log(`\n--- ${name} ---`);
        await fn();
    }
} catch (error) {
    check(`${ONLY ?? 'suite'}: completed without throwing`, false, error.message);
}

await cdp.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length ? `FAILED: ${failed.length}` : 'ALL CHECKS PASSED'} (${results.length} checks)`);
process.exit(failed.length ? 1 : 0);
