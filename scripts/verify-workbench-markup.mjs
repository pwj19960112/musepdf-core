/**
 * End-to-end proof for the workbench markup modes (annotate / stamp / signature / redaction).
 *
 *   npx vite preview --port 4174 &      # NOTE: do not disturb whatever already owns 4173
 *   "/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new \
 *     --remote-debugging-port=9335 --user-data-dir=<scratch>/cdp-markup \
 *     --no-first-run --no-proxy-server --disable-gpu --window-size=1400,900 about:blank &
 *   node scripts/verify-workbench-markup.mjs --cdp 9335 --base http://localhost:4174
 *
 * It drives a real browser: uploads test-fixtures/latin-only.pdf on each entry page, performs the
 * gesture a user would (drag a highlight, click to place a stamp, draw on the signature pad, drag a
 * redaction box, press Apply), then presses the editor's own Export button and captures the bytes the
 * browser was handed. Each export is then
 *   (a) re-uploaded into the workbench and its rendered page canvas sampled for pixels — the "it is
 *       drawn on the page" evidence, taken from PDFium's own raster of the export, and
 *   (b) written to disk for `scripts/verify-markup-export.mjs`, which re-parses it with pdf.js for the
 *       "it is in the file" evidence (`/Annots`, `/Contents`, text extraction).
 *
 * Exit code 1 if any expectation fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { Cdp } from './cdp-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const value = (name, fallback) => {
    const i = args.indexOf(name);
    return i === -1 ? fallback : (args[i + 1] ?? fallback);
};
const PORT = value('--cdp', '9335');
const BASE = value('--base', 'http://localhost:4174');
const OUT = value('--out', path.join(ROOT, 'test-fixtures', 'markup'));
const FIXTURE = value('--fixture', path.join(ROOT, 'test-fixtures', 'latin-only.pdf'));
const ZH_NOTE = '请复核此处标注';
const ZH_STAMP = '已批准';
const VIEWPORT = { width: 1400, height: 900 };

fs.mkdirSync(OUT, { recursive: true });

const failures = [];
const check = (label, ok, detail) => {
    if (!ok) failures.push(label);
    console.log(
        `${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`,
    );
};

const CAPTURE_HOOK = `(() => {
    window.__bentoDownloads = [];
    const original = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
        try { if (blob && blob.type === "application/pdf") window.__bentoDownloads.push(blob); } catch {}
        return original(blob);
    };
    return true;
})()`;

async function saveCapture(cdp, file) {
    const dataUrl = await cdp.waitFor(
        `window.__bentoDownloads.length > 0 ? (async () => {
            const blob = window.__bentoDownloads[window.__bentoDownloads.length - 1];
            return await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(new Error("read failed"));
                reader.readAsDataURL(blob);
            });
        })() : ""`,
        { timeoutMs: 60000, label: 'export capture' },
    );
    const base64 = String(dataUrl).split(',')[1];
    if (!base64) throw new Error(`no PDF bytes captured for ${file}`);
    fs.writeFileSync(file, Buffer.from(base64, 'base64'));
    return fs.statSync(file).size;
}

/** Open an entry page, upload the fixture, and wait for the workbench to show the expected mode. */
async function openWorkbench(entryUrl, expectedMode, { file = FIXTURE } = {}) {
    const cdp = await Cdp.attachPage(PORT, { url: 'about:blank' });
    await cdp.goto(`${BASE}${entryUrl}`);
    await cdp.waitFor(`!!document.querySelector("#file-input")`, { label: '#file-input' });
    await cdp.eval(CAPTURE_HOOK);
    await cdp.setFileInput('#file-input', file);
    const mode = await cdp.waitFor(
        `document.querySelector('[data-testid="stirling-editor-root"]')?.dataset.workbenchMode ?? ""`,
        { timeoutMs: 90000, label: 'workbench mount' },
    );
    check(
        `${entryUrl} mounts the ${expectedMode} mode`,
        mode === expectedMode,
        `data-workbench-mode=${mode}`,
    );
    await cdp.waitFor(`document.querySelectorAll('[data-testid^="pdf-editor-page-"]').length > 0`, {
        timeoutMs: 90000,
        label: 'page render',
    });
    await sleep(900);
    return cdp;
}

/**
 * The visible window over page `index`, in viewport CSS pixels.
 *
 * The stage scrolls its own container and an A4 page is taller than the viewport, so a synthetic
 * mouse event aimed by page fraction can easily land outside the viewport — where it hits nothing and
 * the flow silently does nothing. Every gesture is therefore aimed at the visible part.
 */
async function visibleWindow(cdp, index = 0) {
    await cdp.eval(
        `document.querySelector('[data-testid="pdf-editor-page-${index}"]').scrollIntoView({ block: "start" })`,
    );
    await sleep(400);
    const box = await cdp.rect(`[data-testid="pdf-editor-page-${index}"]`);
    const stage = await cdp.rect('.stirling-editor-stage');
    if (!box || box.width < 50) throw new Error(`page ${index} has no layout box`);
    const top = Math.max(box.y, 56);
    // The page can be wider than the stage column (the panel columns sit next to it) and taller than
    // the viewport; a synthetic mouse event outside the STAGE hits the neighbouring column instead.
    const bottom = Math.min(box.y + box.height, VIEWPORT.height - 24, stage ? stage.y + stage.height : Infinity);
    const left = Math.max(box.x, stage ? stage.x : 0);
    const right = Math.min(box.x + box.width, stage ? stage.x + stage.width : VIEWPORT.width);
    if (bottom - top < 60) throw new Error(`page ${index} has no visible area`);
    return { box, left, right, top, bottom, width: right - left, height: bottom - top };
}

const at = (win, fx, fy) => ({
    x: (win.left ?? win.x) + (win.width ?? 0) * fx,
    y: (win.top ?? win.y) + (win.height ?? 0) * fy,
});

/** Count canvas pixels in a region given as FRACTIONS of the rendered page. */
async function samplePageCanvas(cdp, { pageIndex = 0, x0Frac, y0Frac, x1Frac, y1Frac, match }) {
    return cdp.eval(
        `(() => {
            const canvas = document.querySelector('[data-page-canvas="${pageIndex}"]');
            if (!canvas || !canvas.width) return { error: "no canvas" };
            const ctx = canvas.getContext("2d");
            const box = canvas.getBoundingClientRect();
            const scaleX = canvas.width / box.width;
            const scaleY = canvas.height / box.height;
            const x = Math.max(0, Math.floor(box.width * ${x0Frac} * scaleX));
            const y = Math.max(0, Math.floor(box.height * ${y0Frac} * scaleY));
            const w = Math.min(canvas.width - x, Math.ceil(box.width * (${x1Frac} - ${x0Frac}) * scaleX));
            const h = Math.min(canvas.height - y, Math.ceil(box.height * (${y1Frac} - ${y0Frac}) * scaleY));
            const data = ctx.getImageData(x, y, Math.max(1, w), Math.max(1, h)).data;
            const match = ${match};
            let hits = 0;
            let sample = null;
            for (let i = 0; i < data.length; i += 4) {
                if (data[i + 3] === 0) continue;
                if (match(data[i], data[i + 1], data[i + 2])) {
                    hits += 1;
                    if (!sample) sample = [data[i], data[i + 1], data[i + 2]];
                }
            }
            return { canvas: [canvas.width, canvas.height], hits, sample };
        })()`,
    );
}

/** Re-open a PDF in the workbench and sample its rendered page — the "drawn on the page" evidence. */
async function renderAndSample(file, region) {
    const cdp = await Cdp.attachPage(PORT, { url: 'about:blank' });
    await cdp.goto(`${BASE}/edit-pdf/`);
    await cdp.waitFor(`!!document.querySelector("#file-input")`, { label: '#file-input' });
    await cdp.setFileInput('#file-input', file);
    await cdp.waitFor(`document.querySelectorAll('[data-testid^="pdf-editor-page-"]').length > 0`, {
        timeoutMs: 90000,
        label: 'reopen render',
    });
    await cdp.waitFor(
        `(() => { const c = document.querySelector('[data-page-canvas="0"]'); return !!c && c.width > 10; })()`,
        { timeoutMs: 90000, label: 'first paint' },
    );
    await sleep(600);
    const result = await samplePageCanvas(cdp, region);
    await cdp.close();
    return result;
}

/* ------------------------------------------------------------------ flows */

const results = {};
const YELLOWISH =
    '(r, g, b) => r > 200 && g > 170 && b < 170 && !(r > 246 && g > 246 && b > 246)';
const REDDISH = '(r, g, b) => r > 110 && g < 110 && b < 110';
const DARK = '(r, g, b) => r < 90 && g < 90 && b < 90';

// 1. annotate: highlight (drag) + text note with Chinese /Contents (click)
{
    const cdp = await openWorkbench('/annotate-pdf/', 'annotate');
    let win = await visibleWindow(cdp);
    await cdp.drag(at(win, 0.1, 0.1), at(win, 0.75, 0.2));
    await cdp.eval(
        `(() => { const i = [...document.querySelectorAll('input[type=radio]')].find((x) => x.value === "text"); i.click(); return "ok"; })()`,
    );
    await sleep(300);
    await cdp.fill('[data-testid="workbench-note-text"]', ZH_NOTE);
    await sleep(300);
    win = await visibleWindow(cdp);
    await cdp.clickPoint(at(win, 0.2, 0.34));
    const placed = await cdp.eval(
        `document.querySelector('[data-testid="workbench-markup-count"]')?.textContent`,
    );
    const status = await cdp.eval(
        `document.querySelector('[data-testid="workbench-markup-status"]')?.textContent ?? ""`,
    );
    check('annotate placed a highlight and a text note', /2/.test(placed ?? ''), { placed, status });
    await cdp.click('[data-testid="workbench-markup-export"]');
    results.annotate = {
        bytes: await saveCapture(cdp, path.join(OUT, 'annotate-export.pdf')),
        placed,
    };
    await cdp.close();
}

// 2. stamp: a Chinese label placed by click
{
    const cdp = await openWorkbench('/stamp-pdf/', 'stamp');
    const win = await visibleWindow(cdp);
    await cdp.fill('[data-testid="workbench-stamp-text"]', ZH_STAMP);
    await sleep(300);
    await cdp.clickPoint(at(win, 0.5, 0.5));
    const placed = await cdp.eval(
        `document.querySelector('[data-testid="workbench-markup-count"]')?.textContent`,
    );
    check('stamp placed one stamp', /1/.test(placed ?? ''), placed);
    await cdp.click('[data-testid="workbench-markup-export"]');
    results.stamp = {
        bytes: await saveCapture(cdp, path.join(OUT, 'stamp-export.pdf')),
        placed,
    };
    await cdp.close();
}

// 3. signature: draw on the pad, place, export
{
    const cdp = await openWorkbench('/sign-pdf/', 'sign');
    const pad = await cdp.rect('[data-testid="workbench-signature-pad"]');
    await cdp.drag(at(pad, 0.15, 0.65), at(pad, 0.4, 0.3), { steps: 14 });
    await cdp.drag(at(pad, 0.4, 0.3), at(pad, 0.75, 0.7), { steps: 14 });
    const ink = await cdp.eval(
        `(() => { const c = document.querySelector('[data-testid="workbench-signature-pad"]');
            const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
            let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n += 1; return n; })()`,
    );
    check('signature pad captured ink', ink > 100, `${ink} px`);
    const win = await visibleWindow(cdp);
    await cdp.clickPoint(at(win, 0.5, 0.7));
    const placed = await cdp.eval(
        `document.querySelector('[data-testid="workbench-markup-count"]')?.textContent`,
    );
    check('signature placed', /1/.test(placed ?? ''), placed);
    await cdp.click('[data-testid="workbench-markup-export"]');
    results.sign = {
        bytes: await saveCapture(cdp, path.join(OUT, 'sign-export.pdf')),
        placed,
        ink,
    };
    await cdp.close();
}

// 4. redaction on /edit-pdf/: sidebar → redact, drag over the text line, Apply, export
{
    const cdp = await openWorkbench('/edit-pdf/', 'text');
    await cdp.click('[data-testid="workbench-tool-redact"]');
    const mode = await cdp.waitFor(
        `document.querySelector('[data-testid="stirling-editor-root"]')?.dataset.workbenchMode ?? ""`,
        { timeoutMs: 20000, label: 'redact mode' },
    );
    check(
        '/edit-pdf/ sidebar switches to the redact mode',
        mode === 'redact',
        `data-workbench-mode=${mode}`,
    );
    // Cover the fixture's only text line EXACTLY: drag across the rendered text run. A naive
    // top-strip fraction lands a little above the run (its box was y≈795–831 vs the text's y≈762–780
    // in an earlier run), so the box covered nothing and the text stayed extractable — the very
    // evidence `verify-markup-export.mjs` uses to prove removal. Anchoring to the run removes the
    // guesswork.
    const runGeom = await cdp.eval(`(() => {
        const run = document.querySelector('[data-testid^="pdf-editor-run-"]');
        const page = document.querySelector('[data-testid="pdf-editor-page-0"]');
        const r = run.getBoundingClientRect();
        const p = page.getBoundingClientRect();
        return { run: { x: r.x, y: r.y, w: r.width, h: r.height }, page: { x: p.x, y: p.y, w: p.width, h: p.height } };
    })()`);
    const rFrom = {
        x: Math.max(runGeom.page.x + 1, runGeom.run.x - 12),
        y: Math.max(runGeom.page.y + 1, runGeom.run.y - 8),
    };
    const rTo = {
        x: Math.min(runGeom.page.x + runGeom.page.w - 1, runGeom.run.x + runGeom.run.w + 12),
        y: Math.min(runGeom.page.y + runGeom.page.h - 1, runGeom.run.y + runGeom.run.h + 8),
    };
    await cdp.drag(rFrom, rTo);
    const pending = await cdp.eval(
        `document.querySelector('[data-testid="workbench-redact-pending"]')?.textContent`,
    );
    check('redaction mark registered', /1/.test(pending ?? ''), pending);
    await cdp.click('[data-testid="workbench-redact-apply"]');
    await sleep(1200);
    results.redactStatus = await cdp.eval(
        `document.querySelector('[data-testid="workbench-markup-status"]')?.textContent ?? ""`,
    );
    await cdp.click('[data-testid="workbench-markup-export"]');
    results.redact = { bytes: await saveCapture(cdp, path.join(OUT, 'redact-export.pdf')) };
    await cdp.close();
}

/* -------------------------------------------------- drawn-on-the-page evidence
   Regions are fractions of the PAGE, so the same region can be sampled on the pristine fixture as a
   control — a black pixel count alone would also count the page's own text. */

const STRIP_TOP = { x0Frac: 0, y0Frac: 0.02, x1Frac: 1, y1Frac: 0.12 };
// The redaction is anchored to the text run (see the redact flow), which sits a little lower than
// STRIP_TOP's band, so sample the wider top fifth. Control and export use the SAME band.
const REDACT_BAND = { x0Frac: 0, y0Frac: 0, x1Frac: 1, y1Frac: 0.2 };

console.log('\n--- canvas evidence (exports re-opened and re-rendered by PDFium) ---');

results.controlTop = await renderAndSample(FIXTURE, { ...REDACT_BAND, match: DARK });
console.log('control (pristine fixture), top strip, dark px:', JSON.stringify(results.controlTop));

results.annotateCanvas = await renderAndSample(path.join(OUT, 'annotate-export.pdf'), {
    x0Frac: 0,
    y0Frac: 0,
    x1Frac: 1,
    y1Frac: 1,
    match: YELLOWISH,
});
console.log('annotate export, yellowish px:', JSON.stringify(results.annotateCanvas));
check(
    'annotate export draws the highlight',
    (results.annotateCanvas.hits ?? 0) > 200,
    results.annotateCanvas,
);

results.stampCanvas = await renderAndSample(path.join(OUT, 'stamp-export.pdf'), {
    x0Frac: 0,
    y0Frac: 0.25,
    x1Frac: 1,
    y1Frac: 0.75,
    match: REDDISH,
});
console.log('stamp export, reddish px:', JSON.stringify(results.stampCanvas));
check('stamp export draws the stamp', (results.stampCanvas.hits ?? 0) > 100, results.stampCanvas);

// The signature is placed by a click at 70% of the VISIBLE window, which lands near the middle of
// the (taller-than-viewport) page — so sample the page's middle band, not its lower quarter (an
// earlier run sampled y 0.55–0.95, missed the ink, and false-failed).
results.signCanvas = await renderAndSample(path.join(OUT, 'sign-export.pdf'), {
    x0Frac: 0,
    y0Frac: 0.28,
    x1Frac: 1,
    y1Frac: 0.62,
    match: DARK,
});
console.log(
    'sign export, dark px in the page mid-band:',
    JSON.stringify(results.signCanvas),
);
check('sign export draws the signature', (results.signCanvas.hits ?? 0) > 50, results.signCanvas);

results.redactCanvas = await renderAndSample(path.join(OUT, 'redact-export.pdf'), {
    ...REDACT_BAND,
    match: DARK,
});
console.log('redact export, dark px in the redacted band:', JSON.stringify(results.redactCanvas));
check(
    'redact export draws the blacked-out area',
    (results.redactCanvas.hits ?? 0) > 4 * Math.max(1, results.controlTop.hits ?? 1) &&
        (results.redactCanvas.hits ?? 0) > 3000,
    { redacted: results.redactCanvas.hits, control: results.controlTop.hits },
);

console.log('\n--- flow results ---');
console.log(JSON.stringify(results, null, 2));

if (failures.length) {
    console.error(`\nFAILED: ${failures.join(' | ')}`);
    process.exit(1);
}
console.log('\nall markup flow checks passed');
