/**
 * End-to-end proof for the workbench markup INTERACTION model (drag + resize) and the entry-page
 * wiring, run against the built site.
 *
 *   npx vite preview --port 4173 &                      # (already running elsewhere in this repo)
 *   node scripts/verify-markup-interaction.mjs --cdp 9340 --base http://localhost:4173
 *
 * For every mark type it does the same three steps and compares them:
 *   1. place the mark, read the overlay box's stored RAW-PDF geometry (data-mark-rect)
 *   2. drag the box / drag a resize handle, read the new stored geometry and the on-screen box
 *   3. export, re-open the bytes with pdf.js, and compare the ANNOTATION'S /Rect in the file with
 *      the stored geometry — i.e. "the export writes what the overlay showed"
 *
 * Also checks: the entry pages mount the right mode, the redaction entry maps to /edit-pdf/, and a
 * file set on /sign-pdf/ the moment #file-input exists still opens (the load-ordering fix).
 *
 * Exit 1 if any check fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { Cdp } from './cdp-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const value = (name, fallback) => {
    const i = args.indexOf(name);
    return i === -1 ? fallback : (args[i + 1] ?? fallback);
};
const PORT = value('--cdp', '9340');
const BASE = value('--base', 'http://localhost:4173');
const OUT = value('--out', path.join(ROOT, 'test-fixtures', 'markup'));
const FIXTURE = value('--fixture', path.join(ROOT, 'test-fixtures', 'latin-only.pdf'));
const ZH_NOTE = '请复核此处交互';
fs.mkdirSync(OUT, { recursive: true });

const failures = [];
const check = (label, ok, detail) => {
    if (!ok) failures.push(label);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const CAPTURE = `(() => {
  window.__dl = [];
  const o = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (b) => { try { if (b && b.type === 'application/pdf') window.__dl.push(b); } catch {} return o(b); };
  return true;
})()`;

async function saveCapture(cdp, file) {
    const dataUrl = await cdp.waitFor(
        `window.__dl.length ? (async () => { const b = window.__dl[window.__dl.length-1];
      return await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); }); })() : ""`,
        { timeoutMs: 60000, label: 'export capture' },
    );
    fs.writeFileSync(file, Buffer.from(String(dataUrl).split(',')[1], 'base64'));
    return fs.statSync(file).size;
}

async function open(cdp, url, { file = FIXTURE, timeoutMs = 90000 } = {}) {
    await cdp.goto(`${BASE}${url}`);
    await cdp.waitFor(`!!document.querySelector('#file-input')`, { timeoutMs, label: '#file-input' });
    await cdp.eval(CAPTURE);
    await cdp.setFileInput('#file-input', file);
    const mode = await cdp.waitFor(
        `document.querySelector('[data-testid="stirling-editor-root"]')?.dataset.workbenchMode ?? ""`,
        { timeoutMs, label: 'mount' },
    );
    await cdp.waitFor(`(() => { const c = document.querySelector('[data-page-canvas="0"]'); return !!c && c.width > 10; })()`, {
        timeoutMs,
        label: 'first paint',
    });
    await sleep(800);
    return mode;
}

/** Every mark box the overlay is currently showing. */
async function marks(cdp) {
    return cdp.eval(`(() => [...document.querySelectorAll('[data-testid^="workbench-mark-"]')]
        .filter((el) => /^workbench-mark-/.test(el.dataset.testid ?? '') &&
                        !(el.dataset.testid ?? '').startsWith('workbench-mark-handle') &&
                        !(el.dataset.testid ?? '').startsWith('workbench-markup-'))
        .map((el) => ({
            id: el.dataset.testid.replace('workbench-mark-', ''),
            kind: el.dataset.markKind,
            page: Number(el.dataset.markPage),
            rect: (el.dataset.markRect ?? '').split(',').map(Number),
            box: (el.dataset.markBox ?? '').split(',').map(Number),
            selected: el.dataset.markSelected === '1',
        })))()`);
}

async function placedCount(cdp) {
    const t = await cdp.eval(`document.querySelector('[data-testid="workbench-markup-count"]')?.textContent ?? ''`);
    return Number((/(\d+)/.exec(t) ?? [])[1] ?? 0);
}

const markOf = (list, kind) => list.find((m) => m.kind === kind);

/** Click a mark (by kind) to select it, then wait for its handles. */
async function selectMark(cdp, kind) {
    const list = await marks(cdp);
    const mark = markOf(list, kind) ?? list[0];
    if (!mark) return null;
    const [l, t, w, h] = mark.box;
    await cdp.clickPoint({ x: l + w / 2, y: t + h / 2 });
    await cdp.waitFor(`document.querySelectorAll('[data-testid^="workbench-mark-handle-"]').length > 0`, {
        timeoutMs: 5000,
        label: 'handles',
    });
    return markOf(await marks(cdp), kind) ?? (await marks(cdp))[0];
}

/** Bounding box of a colour predicate over the rendered page, in PAGE FRACTIONS (zoom-invariant). */
async function inkFrac(cdp, matchSrc, pageIndex = 0) {
    return cdp.eval(`(() => {
        const c = document.querySelector('[data-page-canvas="${pageIndex}"]');
        if (!c || !c.width) return { error: 'no canvas' };
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        const match = ${matchSrc};
        let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, hits = 0;
        for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
            const i = (y * c.width + x) * 4;
            if (d[i+3] === 0 || !match(d[i], d[i+1], d[i+2])) continue;
            hits++;
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
        if (maxX < 0) return { hits: 0 };
        return { hits, canvas: [c.width, c.height], frac: {
            x: minX / c.width, yTop: minY / c.height,
            w: (maxX - minX + 1) / c.width, h: (maxY - minY + 1) / c.height,
        } };
    })()`);
}

const REDDISH = '(r,g,b) => r > 110 && g < 110 && b < 110';

/** The visible window over page 0, so synthetic pointers land inside the stage. */
async function window0(cdp) {
    await cdp.eval(`document.querySelector('[data-testid="pdf-editor-page-0"]').scrollIntoView({ block: 'start' })`);
    await sleep(400);
    const box = await cdp.rect('[data-testid="pdf-editor-page-0"]');
    const stage = await cdp.rect('.stirling-editor-stage');
    const top = Math.max(box.y, 56);
    const bottom = Math.min(box.y + box.height, 900 - 24, stage.y + stage.height);
    const left = Math.max(box.x, stage.x);
    const right = Math.min(box.x + box.width, stage.x + stage.width);
    return { left, right, top, bottom, width: right - left, height: bottom - top };
}

/** Read the stamp/highlight/freetext/redact /Rects back out of an export with pdf.js. */
async function annotRects(file) {
    const bytes = new Uint8Array(fs.readFileSync(file));
    const raw = Buffer.from(bytes).toString('latin1');
    const markerCounts = {
        Annots: (raw.match(/\/Annots/g) ?? []).length,
        Highlight: (raw.match(/\/Subtype\s*\/Highlight/g) ?? []).length,
        FreeText: (raw.match(/\/Subtype\s*\/FreeText/g) ?? []).length,
        Stamp: (raw.match(/\/Subtype\s*\/Stamp/g) ?? []).length,
        Redact: (raw.match(/\/Subtype\s*\/Redact/g) ?? []).length,
        Widget: (raw.match(/\/Subtype\s*\/Widget/g) ?? []).length,
        Square: (raw.match(/\/Subtype\s*\/Square/g) ?? []).length,
        ImageXObject: (raw.match(/\/Subtype\s*\/Image/g) ?? []).length,
        AP: (raw.match(/\/AP\b/g) ?? []).length,
    };
    const pdf = await getDocument({ data: bytes }).promise;
    const page = await pdf.getPage(1);
    const annotations = (await page.getAnnotations()).map((a) => ({
        subtype: a.subtype,
        rect: a.rect,
        contents: a.contentsObj?.str ?? a.contents ?? '',
        subject: a.subject,
        hasAppearance: a.hasAppearance ?? !!a.hasOwnCanvas,
    }));
    const text = (await page.getTextContent()).items.map((i) => i.str).join('');
    await pdf.cleanup();
    return { annotations, text, markerCounts, size: bytes.length };
}

const rectOf = (a) => ({ x: a.rect[0], y: a.rect[1], w: a.rect[2] - a.rect[0], h: a.rect[3] - a.rect[1] });

/** Drag a mark's box, or one of its handles, and report stored+on-screen geometry before/after. */
async function gesture(cdp, { kind, handle = null, dx, dy, steps = 10 }) {
    const before = markOf(await marks(cdp), kind) ?? (await marks(cdp))[0];
    const [l, t, w, h] = before.box;
    const from = handle
        ? await cdp.rect(`[data-testid="workbench-mark-handle-${handle}"]`).then((r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 }))
        : { x: l + w / 2, y: t + h / 2 };
    const to = { x: from.x + dx, y: from.y + dy };
    await cdp.drag(from, to, { steps });
    await sleep(500);
    const after = markOf(await marks(cdp), kind) ?? (await marks(cdp))[0];
    return { before, after, from, to };
}

/* ------------------------------------------------------------------ 1. modes */
{
    const cdp = await Cdp.attachPage(PORT, { url: 'about:blank' });
    const mounts = [];
    for (const [url, expect] of [
        ['/annotate-pdf/', 'annotate'],
        ['/stamp-pdf/', 'stamp'],
        ['/sign-pdf/', 'sign'],
    ]) {
        const mode = await open(cdp, url);
        mounts.push({ url, mode });
        check(`${url} mounts mode ${expect}`, mode === expect, mode);
    }
    const slug = await cdp.eval(
        `(() => { const el = document.querySelector('[data-testid="stirling-editor-root"]');
            return el ? { mode: el.dataset.workbenchMode, slug: el.dataset.workbenchSlug } : null; })()`,
    );
    // Click the redact entry and confirm the URL (and the workbench slug) follow to /edit-pdf/.
    await cdp.click('[data-testid="workbench-tool-redact"]');
    const url = await cdp.waitFor(`location.pathname === '/edit-pdf/' ? location.pathname : ''`, {
        timeoutMs: 8000,
        label: 'redact -> /edit-pdf/',
    }).catch(() => '');
    const redactRoot = await cdp.eval(
        `(() => { const el = document.querySelector('[data-testid="stirling-editor-root"]');
            return el ? { mode: el.dataset.workbenchMode, entry: el.dataset.workbenchEntry, slug: el.dataset.workbenchSlug } : null; })()`,
    );
    check(
        'the redact entry maps to /edit-pdf/ (URL + workbench slug)',
        url === '/edit-pdf/' && redactRoot?.slug === 'edit-pdf' && redactRoot?.entry === 'redact',
        { url, redactRoot, redactModeSeenWhileOnSignPdf: slug },
    );
    check('clicking the redact entry switches the workbench to mode redact', redactRoot?.mode === 'redact', redactRoot);
    await cdp.close();
}

/* ------------------------------------------------- 2. immediate file input */
{
    const cdp = await Cdp.attachPage(PORT, { url: 'about:blank' });
    await cdp.goto(`${BASE}/sign-pdf/`);
    // NO settling time and no wait for anything but the input: the file is set the moment it exists.
    await cdp.waitFor(`!!document.querySelector('#file-input')`, { timeoutMs: 20000, label: '#file-input (fast)' });
    await cdp.setFileInput('#file-input', FIXTURE);
    const mode = await cdp.waitFor(
        `document.querySelector('[data-testid="stirling-editor-root"]')?.dataset.workbenchMode ?? ""`,
        { timeoutMs: 90000, label: 'mount after immediate pick' },
    );
    check('/sign-pdf/ accepts a file picked immediately (no wait)', mode === 'sign', mode);
    await cdp.close();
}

/* ------------------------------------------- 3. stamp: drag + resize + export */
let stampStored = null;
{
    const cdp = await Cdp.attachPage(PORT, { url: 'about:blank' });
    await open(cdp, '/stamp-pdf/');
    const win = await window0(cdp);
    await cdp.fill('[data-testid="workbench-stamp-text"]', 'DRAFT');
    await cdp.clickPoint({ x: win.left + win.width * 0.45, y: win.top + win.height * 0.4 });
    await sleep(1200);
    check('stamp placed', (await placedCount(cdp)) === 1);

    const placed = await marks(cdp);
    check('the placed stamp has an overlay box with stored geometry', placed.length === 1 && placed[0].rect.length === 4, placed);
    const scale = placed[0].box[2] / placed[0].rect[2];

    // --- drag
    const dragRes = await gesture(cdp, { kind: 'stamp', dx: 150, dy: 90 });
    const dxRaw = (dragRes.after.rect[0] - dragRes.before.rect[0]);
    const dyRaw = (dragRes.after.rect[1] - dragRes.before.rect[1]);
    check(
        'stamp drag moved the stored rect by the pointer delta (raw pts)',
        near(dxRaw, 150 / scale, 3) && near(dyRaw, -90 / scale, 3),
        { dxRaw, dyRaw, expectX: 150 / scale, expectY: -90 / scale },
    );
    check(
        'the stamp box followed the pointer on screen',
        near(dragRes.after.box[0] - dragRes.before.box[0], 150, 4) &&
            near(dragRes.after.box[1] - dragRes.before.box[1], 90, 4),
        { boxBefore: dragRes.before.box, boxAfter: dragRes.after.box },
    );
    check('the stamp kept its size while moving', near(dragRes.after.rect[2], dragRes.before.rect[2], 0.5), {
        w0: dragRes.before.rect[2],
        w1: dragRes.after.rect[2],
    });

    // --- resize (corner handle, aspect-locked)
    const selected = await selectMark(cdp, 'stamp');
    const aspect0 = selected.rect[2] / selected.rect[3];
    const resizeRes = await gesture(cdp, { kind: 'stamp', handle: 'se', dx: 70, dy: 45 });
    const r0 = resizeRes.before.rect;
    const r1 = resizeRes.after.rect;
    check(
        'stamp resize grew the stored rect with the pointer (raw pts)',
        near(r1[2] - r0[2], 70 / scale, 4),
        { w0: r0[2], w1: r1[2], expectW: 70 / scale },
    );
    check(
        'stamp resize kept the aspect ratio',
        near(r1[2] / r1[3], aspect0, 0.02),
        { aspect0, aspect1: r1[2] / r1[3] },
    );
    check('the stamp stayed inside the page after resize', r1[0] >= 0 && r1[1] >= 0, r1);

    // --- zoom invariance: the WHOLE stamp must stay drawn over its whole rect, at its correct
    //     aspect, at every zoom level. Page fractions are zoom-invariant, so the drawn ink and the
    //     stored rect are compared in those units at three zoom levels.
    const zoomLevels = [
        { label: 'default zoom', out: 0, in: 0 },
        { label: 'zoomed out (2 steps)', out: 2, in: 0 },
        { label: 'zoomed in (4 steps)', out: 0, in: 4 },
    ];
    const zoomResults = [];
    for (const level of zoomLevels) {
        for (let i = 0; i < level.out; i++) {
            await cdp.click('[data-testid="pdf-editor-zoom-out"]');
            await sleep(250);
        }
        for (let i = 0; i < level.in; i++) {
            await cdp.click('[data-testid="pdf-editor-zoom-in"]');
            await sleep(250);
        }
        await sleep(900);
        const mark = markOf(await marks(cdp), 'stamp');
        const ink = await inkFrac(cdp, REDDISH);
        const pageRect = await cdp.rect('[data-testid="pdf-editor-page-0"]');
        const scale = mark.box[2] / mark.rect[2];
        const zoom = await cdp.eval(`document.querySelector('[data-testid="pdf-editor-zoom-percent"]')?.textContent ?? ''`);
        zoomResults.push({ label: level.label, zoom, scale, box: mark.box, rect: mark.rect, ink });
        // The ink must cover (nearly) the whole rect: the border stroke is inset ~2.8pt, so the ink
        // box is a little smaller than the rect — but never a quarter of it.
        const rectFrac = { w: mark.box[2] / pageRect.width, h: mark.box[3] / pageRect.height };
        const inkCovers = !!ink.frac && ink.frac.w > 0.9 * rectFrac.w && ink.frac.h > 0.9 * rectFrac.h;
        const aspectOk = Math.abs(mark.box[2] / mark.box[3] / (mark.rect[2] / mark.rect[3]) - 1) < 0.03;
        check(
            `stamp is still drawn whole over its rect at ${level.label}`,
            inkCovers && aspectOk && ink.hits > 1500,
            { zoom, box: mark.box, rect: mark.rect, ink: ink.frac, rectFrac, hits: ink.hits, scale },
        );
    }
    const widths = zoomResults.map((z) => z.ink.frac?.w ?? 0);
    const heights = zoomResults.map((z) => z.ink.frac?.h ?? 0);
    check(
        'the drawn stamp keeps the same page fractions at every zoom level',
        Math.max(...widths) - Math.min(...widths) < 0.02 && Math.max(...heights) - Math.min(...heights) < 0.02,
        { widths, heights },
    );
    check(
        'the on-screen box scales with zoom while its page fractions stay put',
        new Set(zoomResults.map((z) => Math.round(z.scale * 100))).size > 1,
        zoomResults.map((z) => ({ zoom: z.zoom, scale: z.scale })),
    );
    console.log('zoom sweep:', JSON.stringify(zoomResults));
    // back to the default zoom for the export
    await cdp.click('[data-testid="pdf-editor-zoom-reset"]');
    await sleep(600);

    stampStored = r1;
    await cdp.click('[data-testid="workbench-markup-export"]');
    const file = path.join(OUT, 'interaction-stamp.pdf');
    const bytes = await saveCapture(cdp, file);
    const info = await annotRects(file);
    const stamp = info.annotations.find((a) => a.subtype === 'Stamp');
    check('stamp export carries a /Stamp annotation', !!stamp, info.markerCounts);
    if (stamp) {
        const rr = rectOf(stamp);
        check(
            'the exported stamp /Rect matches the overlay geometry',
            near(rr.x, stampStored[0], 1) && near(rr.y, stampStored[1], 1) &&
                near(rr.w, stampStored[2], 1) && near(rr.h, stampStored[3], 1),
            { exported: rr, overlay: stampStored },
        );
    }
    console.log('stamp export bytes:', bytes);
    await cdp.close();
}

/* --------------------------------- 4. highlight + Chinese note: drag + resize */
{
    const cdp = await Cdp.attachPage(PORT, { url: 'about:blank' });
    await open(cdp, '/annotate-pdf/');
    let win = await window0(cdp);
    // highlight (drag a region)
    await cdp.drag({ x: win.left + win.width * 0.12, y: win.top + win.height * 0.12 }, { x: win.left + win.width * 0.6, y: win.top + win.height * 0.2 });
    await sleep(700);
    // text note with Chinese contents
    await cdp.eval(`(() => { const i = [...document.querySelectorAll('input[type=radio]')].find((x) => x.value === 'text'); i.click(); return 'ok'; })()`);
    await sleep(300);
    await cdp.fill('[data-testid="workbench-note-text"]', ZH_NOTE);
    await sleep(300);
    win = await window0(cdp);
    await cdp.clickPoint({ x: win.left + win.width * 0.25, y: win.top + win.height * 0.35 });
    await sleep(1200);
    check('annotate placed a highlight and a text note', (await placedCount(cdp)) === 2, await placedCount(cdp));

    const all = await marks(cdp);
    const hi = all.find((m) => m.kind === 'highlight');
    const tx = all.find((m) => m.kind === 'text');
    check('both marks have overlay boxes', !!hi && !!tx, all.map((m) => m.kind));

    // --- drag the text note (down-right on screen == +x, -y in raw page space)
    const txScale = tx.box[2] / tx.rect[2];
    const [l, t, w, h] = tx.box;
    const from = { x: l + w / 2, y: t + h / 2 };
    await cdp.clickPoint(from);
    await sleep(300);
    await cdp.drag(from, { x: from.x - 120, y: from.y + 100 }, { steps: 10 });
    await sleep(500);
    const txAfter = (await marks(cdp)).find((m) => m.kind === 'text');
    check(
        'text note drag moved its stored rect by the pointer delta',
        near(txAfter.rect[0] - tx.rect[0], -120 / txScale, 3) && near(txAfter.rect[1] - tx.rect[1], -100 / txScale, 3),
        { before: tx.rect, after: txAfter.rect, scale: txScale },
    );
    check(
        'the text note box followed the pointer on screen',
        near(txAfter.box[0] - tx.box[0], -120, 4) && near(txAfter.box[1] - tx.box[1], 100, 4),
        { before: tx.box, after: txAfter.box },
    );

    // --- drag the highlight too
    const [hl, ht, hw, hh] = hi.box;
    const hFrom = { x: hl + hw / 2, y: ht + hh / 2 };
    await cdp.clickPoint(hFrom);
    await sleep(300);
    await cdp.drag(hFrom, { x: hFrom.x - 60, y: hFrom.y - 40 }, { steps: 10 });
    await sleep(500);
    const hiAfter = (await marks(cdp)).find((m) => m.kind === 'highlight');
    check(
        'highlight drag moved its stored rect by the pointer delta',
        near(hiAfter.rect[0] - hi.rect[0], -60 / txScale, 3) && near(hiAfter.rect[1] - hi.rect[1], 40 / txScale, 3),
        { before: hi.rect, after: hiAfter.rect },
    );

    // --- resize the highlight with the 'se' corner (free aspect: width and height move together)
    const sel = await selectMark(cdp, 'highlight');
    const hiScale = sel.box[2] / sel.rect[2];
    const resizeRes = await gesture(cdp, { kind: 'highlight', handle: 'se', dx: 90, dy: 60 });
    const h0 = resizeRes.before.rect;
    const h1 = resizeRes.after.rect;
    check(
        'highlight resize grew width and height freely (raw pts)',
        near(h1[2] - h0[2], 90 / hiScale, 5) && near(h1[3] - h0[3], 60 / hiScale, 5),
        { w0: h0[2], w1: h1[2], h0: h0[3], h1: h1[3], scale: hiScale },
    );

    // --- resize the text note (free aspect) and export
    const txNow = await selectMark(cdp, 'text');
    const txScale2 = txNow.box[2] / txNow.rect[2];
    const txResize = await gesture(cdp, { kind: 'text', handle: 'se', dx: 80, dy: 50 });
    const t0 = txResize.before.rect;
    const t1 = txResize.after.rect;
    check(
        'text note resize grew width and height freely (raw pts)',
        near(t1[2] - t0[2], 80 / txScale2, 5) && near(t1[3] - t0[3], 50 / txScale2, 5),
        { w0: t0[2], w1: t1[2], h0: t0[3], h1: t1[3], scale: txScale2 },
    );

    await cdp.click('[data-testid="workbench-markup-export"]');
    const file = path.join(OUT, 'interaction-annotate.pdf');
    const bytes = await saveCapture(cdp, file);
    const info = await annotRects(file);
    const highlight = info.annotations.find((a) => a.subtype === 'Highlight');
    const freeText = info.annotations.find((a) => a.subtype === 'FreeText');
    check('annotate export carries /Highlight and /FreeText', !!highlight && !!freeText, info.markerCounts);
    check(
        'the exported highlight /Rect matches the overlay geometry',
        !!highlight && near(rectOf(highlight).x, h1[0], 1) && near(rectOf(highlight).y, h1[1], 1) &&
            near(rectOf(highlight).w, h1[2], 1) && near(rectOf(highlight).h, h1[3], 1),
        { exported: highlight && rectOf(highlight), overlay: h1 },
    );
    check(
        `the Chinese text note round-trips (${ZH_NOTE})`,
        freeText?.contents === ZH_NOTE,
        freeText?.contents,
    );
    check(
        'the exported text note /Rect matches the overlay geometry',
        !!freeText && near(rectOf(freeText).x, t1[0], 1) && near(rectOf(freeText).y, t1[1], 1) &&
            near(rectOf(freeText).w, t1[2], 1) && near(rectOf(freeText).h, t1[3], 1),
        { exported: freeText && rectOf(freeText), overlay: t1 },
    );
    console.log('annotate export bytes:', bytes);
    await cdp.close();
}

/* -------------------------------------------------------- 5. signature drag */
{
    const cdp = await Cdp.attachPage(PORT, { url: 'about:blank' });
    await open(cdp, '/sign-pdf/');
    const pad = await cdp.rect('[data-testid="workbench-signature-pad"]');
    await cdp.drag({ x: pad.x + pad.width * 0.2, y: pad.y + pad.height * 0.6 }, { x: pad.x + pad.width * 0.7, y: pad.y + pad.height * 0.35 }, { steps: 12 });
    await sleep(300);
    const win = await window0(cdp);
    await cdp.clickPoint({ x: win.left + win.width * 0.4, y: win.top + win.height * 0.45 });
    await sleep(1200);
    const placed = await marks(cdp);
    check('signature placed with an overlay box', placed.length === 1, placed);
    if (placed.length) {
        const g = await gesture(cdp, { kind: 'signature', dx: 60, dy: 60 });
        const moved = !near(g.after.rect[0], g.before.rect[0], 0.5) && !near(g.after.rect[1], g.before.rect[1], 0.5);
        check('signature is draggable', moved, { before: g.before.rect, after: g.after.rect });
        const selected = await selectMark(cdp, 'signature');
        const handles = await cdp.eval(`document.querySelectorAll('[data-testid^="workbench-mark-handle-"]').length`);
        check('the selected signature shows resize handles', handles === 4, handles);
        const res = await gesture(cdp, { kind: 'signature', handle: 'se', dx: 50, dy: 30 });
        check('signature resize kept the aspect ratio',
            near(res.after.rect[2] / res.after.rect[3], selected.rect[2] / selected.rect[3], 0.03),
            { before: selected.rect, after: res.after.rect });
    }
    await cdp.close();
}

/* ------------------------------------------------------------ 6. redaction box */
{
    const cdp = await Cdp.attachPage(PORT, { url: 'about:blank' });
    await open(cdp, '/edit-pdf/');
    await cdp.click('[data-testid="workbench-tool-redact"]');
    await cdp.waitFor(`document.querySelector('[data-testid="stirling-editor-root"]')?.dataset.workbenchMode === 'redact' ? '1' : ''`, { timeoutMs: 15000, label: 'redact mode' });
    const win = await window0(cdp);
    await cdp.drag({ x: win.left + win.width * 0.1, y: win.top + win.height * 0.1 }, { x: win.left + win.width * 0.5, y: win.top + win.height * 0.2 });
    await sleep(900);
    const placed = await marks(cdp);
    check('redaction box placed with an overlay box', placed.length === 1 && placed[0].kind === 'redact', placed);
    if (placed.length) {
        const scale = placed[0].box[2] / placed[0].rect[2];
        const g = await gesture(cdp, { kind: 'redact', dx: 80, dy: 70 });
        check('redaction box is draggable',
            near(g.after.rect[0] - g.before.rect[0], 80 / scale, 3) && near(g.after.rect[1] - g.before.rect[1], -70 / scale, 3),
            { before: g.before.rect, after: g.after.rect });
        await selectMark(cdp, 'redact');
        const res = await gesture(cdp, { kind: 'redact', handle: 'se', dx: 60, dy: 40 });
        check('redaction box is resizable (free aspect)',
            near(res.after.rect[2] - res.before.rect[2], 60 / scale, 5),
            { before: res.before.rect, after: res.after.rect });
        const stored = res.after.rect;
        await cdp.click('[data-testid="workbench-markup-export"]');
        const file = path.join(OUT, 'interaction-redact.pdf');
        const bytes = await saveCapture(cdp, file);
        const info = await annotRects(file);
        const redact = info.annotations.find((a) => a.subtype === 'Redact');
        check('redaction export carries a /Redact annotation (mark only, not applied yet)', !!redact, info.markerCounts);
        check('the exported redaction /Rect matches the overlay geometry',
            !!redact && near(rectOf(redact).x, stored[0], 1) && near(rectOf(redact).w, stored[2], 1),
            { exported: redact && rectOf(redact), overlay: stored });
        console.log('redact export bytes:', bytes);
    }
    await cdp.close();
}

console.log('\n================ interaction summary ================');
if (failures.length) {
    console.error(`FAILED: ${failures.join(' | ')}`);
    process.exit(1);
}
console.log('all interaction checks passed');
