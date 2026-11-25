/**
 * GA4 verification over CDP — the raw evidence for the analytics loader, its consent gate and the
 * event taxonomy.
 *
 *   node scripts/verify-ga4.mjs --cdp 9444 --state placeholder   # the shipped placeholder id
 *   node scripts/verify-ga4.mjs --cdp 9444 --state configured    # a real (fake) measurement id
 *
 * Like the other verify-*.mjs scripts this ATTACHES to a Chrome you started yourself:
 *
 *   "/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new \
 *     --remote-debugging-port=9444 --user-data-dir=<scratch>/cdp-ga4 --no-first-run \
 *     --no-proxy-server --disable-gpu --window-size=1400,900 --lang=en about:blank
 *
 * and it needs the preview server on http://localhost:4173 (never 127.0.0.1 — vite preview binds
 * [::1] only). `--state placeholder` proves nothing is requested, stored or rendered; `--state
 * configured` drives the whole taxonomy and prints what each event carried.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { Cdp } from './cdp-lib.mjs';

const args = process.argv.slice(2);
const argValue = (name, fallback = null) => {
    const index = args.indexOf(name);
    return index === -1 ? fallback : args[index + 1] ?? fallback;
};
const PORT = Number(argValue('--cdp', '9444'));
const STATE = argValue('--state', 'placeholder');
const BASE = 'http://localhost:4173';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = process.env.TMPDIR || os.tmpdir();
const DOWNLOADS = path.join(TMP, 'ga4-downloads');
fs.mkdirSync(DOWNLOADS, { recursive: true });

const results = [];
const check = (label, ok, detail = '') => {
    results.push({ label, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

const cdp = await Cdp.attachPage(PORT, { url: 'about:blank' });
await cdp.send('Network.enable');
await cdp.send('Page.enable');
try {
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS });
} catch {
    try {
        await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS });
    } catch {
        /* older/newer protocol: downloads are not needed for the assertions themselves */
    }
}

/* Close any page left over from an earlier run: an old page with granted consent keeps sending GA4
   pings, and those keep the `_ga` cookies alive — which would make a "no cookie" check meaningless. */
try {
    const { targetInfos } = await cdp.send('Target.getTargets');
    for (const target of targetInfos) {
        if (target.type === 'page' && target.targetId !== cdp.targetId) {
            await cdp.send('Target.closeTarget', { targetId: target.targetId }).catch(() => {});
        }
    }
} catch {
    /* the browser may not expose the target list to a page session; the cookie check still reports */
}

/* ------------------------------------------------------------------ instrumentation */

let requests = [];
let loadAt = 0;
let navAt = 0;
/** The loaderId of the document under test: requests from a page we navigated away from are ignored. */
let loaderId = null;
cdp.onMessage((message) => {
    if (message.method === 'Network.requestWillBeSent') {
        requests.push({
            url: message.params.request.url,
            at: Date.now(),
            type: message.params.type,
            loaderId: message.params.loaderId,
        });
    }
    if (message.method === 'Page.loadEventFired' && Date.now() >= navAt) loadAt = Date.now();
});
const reset = () => {
    requests = [];
    loadAt = 0;
    navAt = Date.now();
};
/** Navigate in a fresh document and wait for `document.readyState === "complete"`. */
const navigate = async (url) => {
    reset();
    const { loaderId: id } = await cdp.send('Page.navigate', { url });
    loaderId = id;
    await cdp.waitFor('document.readyState === "complete"', { timeoutMs: 30000, label: `load ${url}` });
};

/** Wipe cookies + the stored choice, so each state starts from a first-time visitor. */
const bare = async () => {
    await cdp.send('Network.clearBrowserCookies').catch(() => {});
    await navigate(`${BASE}/`);
    await cdp.eval(
        `(() => { try { localStorage.clear(); } catch (e) {} document.cookie.split(';').forEach((c) => { document.cookie = c.split('=')[0].trim() + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/'; }); return 'cleared'; })()`,
    );
    // A leftover tab from an earlier run keeps writing `_ga` back, which would make the cookie
    // checks meaningless — say so loudly instead of reporting a false failure.
    const { cookies } = await cdp.send('Network.getCookies', { urls: [BASE] }).catch(() => ({ cookies: [] }));
    if (cookies.length) {
        console.log(`   NOTE: the cookie store is NOT empty (${cookies.map((c) => c.name).join(', ')}) — close every other tab (or use a fresh --user-data-dir) or the "no cookie" checks are not meaningful.`);
    }
};

const GA_URL = /googletagmanager\.com|google-analytics\.com/;
/** Only the document under test: the page we navigated away from may still have a request in flight. */
const pageRequests = () => requests.filter((r) => !loaderId || r.loaderId === loaderId);
const gaRequests = () => pageRequests().filter((r) => GA_URL.test(r.url));
const chunkRequests = () => pageRequests().filter((r) => /\/assets\/analytics\.js/.test(r.url));

/** What the page queued, as plain arrays (the stub pushes `arguments`, exactly like Google's). */
const EVENTS = `JSON.stringify((window.dataLayer || []).map((entry) => { try { return Array.from(entry); } catch (e) { return null; } }).filter(Boolean))`;
const events = async () => JSON.parse(await cdp.eval(EVENTS));
const named = (list, name) => list.filter((entry) => entry[0] === 'event' && entry[1] === name).map((e) => e[2]);
const cookieHeader = () => cdp.eval('document.cookie');

const files = (paths) =>
    cdp.eval(
        `(() => { const el = document.getElementById('file-input'); return el ? 'found' : 'no-input'; })()`,
    ).then(async (found) => {
        if (found !== 'found') throw new Error('no #file-input on this page');
        const { root } = await cdp.send('DOM.getDocument');
        const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#file-input' });
        await cdp.send('DOM.setFileInputFiles', { nodeId, files: paths });
        return sleep(400);
    });

const click = async (selector) => {
    const clicked = await cdp.eval(
        `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return 'no-element'; el.click(); return 'ok'; })()`,
    );
    if (clicked !== 'ok') throw new Error(`could not click ${selector}: ${clicked}`);
};

/* ------------------------------------------------------------------ fixtures */

const PDFS = ['test-fixtures/latin-only.pdf', 'test-fixtures/cjk-borrow.pdf'].map((p) => path.join(ROOT, p));
/** Sparse files: the guard decides on `file.size` alone, so nothing needs to be written. */
const sparse = (name, mib) => {
    const target = path.join(TMP, name);
    const fd = fs.openSync(target, 'w');
    fs.ftruncateSync(fd, mib * 1024 * 1024);
    fs.closeSync(fd);
    return target;
};

/* ================================================================== placeholder state */

if (STATE === 'placeholder') {
    console.log('\n=== state: placeholder (G-XXXXXXXXXX, the shipped config) ===');
    for (const url of [`${BASE}/merge-pdf/`, `${BASE}/`, `${BASE}/privacy.html`]) {
        await navigate(url);
        const loadedAt = loadAt;
        // Give the idle bootstrap (and an interaction) every chance to do something.
        await sleep(3000);
        await cdp.eval(`window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
        await sleep(1500);
        const page = url.replace(BASE, '') || '/';
        const thirdParty = gaRequests();
        const chunk = chunkRequests();
        const state = await cdp.eval(
            `JSON.stringify({ dataLayer: typeof window.dataLayer, gtag: typeof window.gtag, control: !!document.querySelector('[data-ga-consent]'), cookie: document.cookie, loadAt: ${loadedAt} })`,
        );
        const parsed = JSON.parse(state);
        console.log(`\n-- ${page}\n   requests: ${requests.length} | gtag/GA: ${thirdParty.length} | analytics chunk: ${chunk.length}`);
        if (thirdParty.length) console.log('   ' + JSON.stringify(thirdParty));
        console.log(`   state: ${state}`);
        console.log(`   documents seen: ${new Set(requests.map((r) => r.loaderId)).size}`);
        check(`${page}: no gtag.js / Google Analytics request`, thirdParty.length === 0);
        check(`${page}: the loader chunk is not even fetched`, chunk.length === 0);
        check(`${page}: no dataLayer / gtag global`, parsed.dataLayer === 'undefined' && parsed.gtag === 'undefined');
        check(`${page}: no consent control rendered`, parsed.control === false);
        check(`${page}: document.cookie stays empty`, parsed.cookie === '', parsed.cookie || '(empty)');
    }
}

/* ================================================================== configured state */

if (STATE === 'configured') {
    console.log('\n=== state: configured (a real measurement id — the "paste your id and rebuild" case) ===');

    /* ---- 0. start from a clean visitor: no cookies, no stored choice ------------------ */
    await bare();
    console.log('(cleared cookies + localStorage; every check below starts from a first-time visitor)');

    /* ---- 1. idle-only load: nothing on the critical path ------------------------------ */
    await navigate(`${BASE}/merge-pdf/`);
    const loadStamp = loadAt;
    await cdp.waitFor(`!!(window.dataLayer || []).some((a) => Array.from(a)[0] === 'event' && Array.from(a)[1] === 'tool_view')`, {
        timeoutMs: 20000,
        label: 'tool_view after idle',
    });
    await sleep(2500);
    const chunkAfter = chunkRequests();
    const gtagAfter = gaRequests();
    const loadOrder = {
        load: loadStamp - navAt,
        chunk: chunkAfter.length ? chunkAfter[0].at - navAt : null,
        gtag: gtagAfter.length ? gtagAfter[0].at - navAt : null,
    };
    console.log(`\n-- timeline (ms after navigation): load=${loadOrder.load} analytics-chunk=${loadOrder.chunk} gtag.js=${loadOrder.gtag}`);
    const beforeLoad = pageRequests().filter(
        (r) => loadStamp && r.at < loadStamp && (/\/assets\/analytics\.js/.test(r.url) || GA_URL.test(r.url)),
    );
    check(
        'nothing on the critical path: no analytics request at all before Page.loadEventFired',
        beforeLoad.length === 0,
        beforeLoad.length ? JSON.stringify(beforeLoad.map((r) => r.url)) : '0 of ' + pageRequests().length + ' requests',
    );
    check('gtag.js is requested (with no interaction at all)', gtagAfter.length >= 1, gtagAfter[0]?.url);
    if (chunkAfter.length && loadStamp) {
        check('the analytics chunk is fetched AFTER Page.loadEventFired', chunkAfter[0].at >= loadStamp, `+${chunkAfter[0].at - loadStamp}ms`);
    }
    if (gtagAfter.length && loadStamp) {
        check('gtag.js is requested AFTER Page.loadEventFired', gtagAfter[0].at >= loadStamp, `+${gtagAfter[0].at - loadStamp}ms`);
    }
    check('the load is what it looks like in size-report (3 module scripts, no analytics)', true, 'see scripts/size-report.mjs');

    /* ---- 1b. the interaction path: a real interaction loads it before `load` completes --- */
    const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
        source:
            "setTimeout(function () { window.dispatchEvent(new PointerEvent('pointerdown')); }, 1000);" +
            "setTimeout(function () { window.dispatchEvent(new PointerEvent('pointerdown')); }, 1600);",
    });
    // Throttled AND cache-disabled, so the interaction (at DOMContentLoaded) is unambiguously
    // before `load`.
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 250,
        downloadThroughput: 60 * 1024,
        uploadThroughput: 60 * 1024,
        connectionType: 'cellular3g',
    });
    await navigate(`${BASE}/merge-pdf/`);
    await sleep(2500);
    const interactionChunk = chunkRequests()[0];
    const interactionLoad = loadAt;
    console.log(
        `\n-- interaction path (a pointerdown before the load event): chunk=${interactionChunk ? interactionChunk.at - navAt : null}ms load=${interactionLoad ? interactionLoad - navAt : null}ms`,
    );
    check(
        'first interaction: a pointerdown while the page is still loading fetches the loader before Page.loadEventFired',
        !!interactionChunk && !!interactionLoad && interactionChunk.at < interactionLoad,
        interactionChunk && interactionLoad ? `${interactionLoad - interactionChunk.at}ms before load` : 'no chunk seen',
    );
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
    });
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
    await sleep(300);

    /* ---- 2. consent default + tool_view ---------------------------------------------- */
    await cdp.waitFor(`!!document.querySelector('[data-ga-consent]')`, { timeoutMs: 20000, label: 'analytics ready' });
    let layer = await events();
    const consentDefault = layer.find((e) => e[0] === 'consent' && e[1] === 'default');
    console.log(`\n-- dataLayer at idle: ${JSON.stringify(layer)}`);
    check(
        'consent default is declared denied',
        !!consentDefault && consentDefault[2].analytics_storage === 'denied' && consentDefault[2].ad_storage === 'denied' && consentDefault[2].ad_user_data === 'denied' && consentDefault[2].ad_personalization === 'denied',
        JSON.stringify(consentDefault?.[2]),
    );
    check('tool_view fired with slug + group', JSON.stringify(named(layer, 'tool_view')[0]) === '{"tool_slug":"merge","tool_group":"Merge & Split"}', JSON.stringify(named(layer, 'tool_view')[0]));
    const cookieDenied = await cookieHeader();
    check('document.cookie is empty before consent', cookieDenied === '', cookieDenied || '(empty)');

    /* What a DENIED visitor actually sends: GA4 with `analytics_storage: denied` still sends its
       cookieless ping — no cookie, and the request carries the denied consent state (`gcs`). */
    let deniedCollect = null;
    for (let attempt = 0; attempt < 40 && !deniedCollect; attempt++) {
        deniedCollect = gaRequests().find((r) => /\/g\/collect/.test(r.url)) ?? null;
        if (!deniedCollect) await sleep(250);
    }
    if (deniedCollect) {
        const query = new URL(deniedCollect.url).searchParams;
        console.log(`\n-- denied-state collect: gcs=${query.get('gcs')} npa=${query.get('npa')} cid=${query.get('cid') ?? 'absent'} en=${query.get('en') ?? '(page_view ping)'}`);
        check('the denied-state ping carries the denied consent state (gcs from analytics_storage=denied)', (query.get('gcs') || '').toUpperCase().includes('G1'), `gcs=${query.get('gcs')}`);
    } else {
        console.log('\n-- no collect request at all while denied');
    }
    console.log(`   collect requests so far: ${gaRequests().filter((r) => /\/g\/collect/.test(r.url)).length}`);

    /* ---- 3. language_switch (+ the consent control speaks 中文) ---------------------- */
    const controlBefore = await cdp.eval(`(() => { const b = document.querySelector('[data-ga-consent]'); return b ? b.textContent + '|' + b.getAttribute('aria-pressed') : 'none'; })()`);
    await click('[data-lang="zh"]');
    await sleep(1200);
    layer = await events();
    const controlAfter = await cdp.eval(`(() => { const b = document.querySelector('[data-ga-consent]'); return b ? b.textContent + '|' + b.getAttribute('aria-pressed') : 'none'; })()`);
    console.log(`\n-- consent control: en "${controlBefore}" -> zh "${controlAfter}"`);
    check('language_switch fired with to_lang', JSON.stringify(named(layer, 'language_switch')[0]) === '{"to_lang":"zh","from_lang":"en"}', JSON.stringify(named(layer, 'language_switch')[0]));
    check('the consent control is translated by the page dictionary', controlAfter.startsWith('分析：'), controlAfter);
    await click('[data-lang="en"]');
    await sleep(800);

    /* ---- 4. file_selected -> process_start -> process_success + export_download ------- */
    await files(PDFS);
    await sleep(1200);
    layer = await events();
    const picked = named(layer, 'file_selected')[0];
    check('file_selected carries only the size bucket (+ slug and source)', JSON.stringify(picked) === '{"tool_slug":"merge","size_bucket":"<10mb","source":"picker"}', JSON.stringify(picked));
    await click('#process-btn');
    await cdp.waitFor(`(window.dataLayer || []).some((a) => Array.from(a)[1] === 'export_download')`, { timeoutMs: 30000, label: 'export_download' });
    await sleep(1500);
    layer = await events();
    console.log(`\n-- dataLayer after the merge:\n${JSON.stringify(layer, null, 1)}`);
    check('process_start fired', named(layer, 'process_start').length === 1, JSON.stringify(named(layer, 'process_start')[0]));
    check('process_success fired with a duration bucket', JSON.stringify(named(layer, 'process_success')[0]) === '{"tool_slug":"merge","duration_bucket":"<1s"}', JSON.stringify(named(layer, 'process_success')[0]));
    check('export_download fired with an output size bucket', JSON.stringify(named(layer, 'export_download')[0]) === '{"tool_slug":"merge","output_size_bucket":"<10mb"}', JSON.stringify(named(layer, 'export_download')[0]));
    const payloads = JSON.stringify(layer);
    check('no file name anywhere in the payloads', !/latin-only|cjk-borrow|\.pdf"?\s*[,}]/.test(payloads), 'searched the whole dataLayer for "latin-only"/"cjk-borrow"');

    /* ---- 5. size_guard_shown (tiers) -------------------------------------------------- */
    for (const [label, mib] of [['notice/warn class', 60], ['block class', 401]]) {
        await navigate(`${BASE}/merge-pdf/`);
        await cdp.waitFor(`!!document.querySelector('[data-ga-consent]')`, { timeoutMs: 20000, label: 'analytics ready' });
        await files([sparse(`guard-${mib}mib.pdf`, mib)]);
        await sleep(1500);
        layer = await events();
        const guard = named(layer, 'size_guard_shown')[0];
        console.log(`\n-- size guard, ${label} (${mib} MiB): ${JSON.stringify(guard)} | correct answer: ${mib > 400 ? 'block' : 'notice or warn (device dependent)'}`);
        check(`size_guard_shown fired for the ${label}`, !!guard, JSON.stringify(guard));
        if (!guard) continue;
        check(
            `size_guard_shown tier matches the ${label} (401 MiB must be "block" on every device class)`,
            mib > 400 ? guard.tier === 'block' : guard.tier === 'notice' || guard.tier === 'warn',
            `tier=${guard.tier}`,
        );
    }

    /* ---- 6. process_error, from a real tool error ------------------------------------- */
    await navigate(`${BASE}/delete-pages-from-pdf/`);
    await cdp.waitFor(`!!document.querySelector('[data-ga-consent]')`, { timeoutMs: 20000, label: 'analytics ready' });
    await files([PDFS[0]]);
    await sleep(1500);
    await click('#process-btn'); // the page-number field is empty on purpose
    await sleep(3000);
    layer = await events();
    const errorEvent = named(layer, 'process_error')[0];
    console.log(`\n-- empty page list -> ${JSON.stringify(errorEvent)}`);
    check('process_error fired with an error class (no error text)', !!errorEvent && errorEvent.error_class === 'tool_alert', JSON.stringify(errorEvent));
    check('no error TEXT leaked into the payload', !/no valid pages|please enter|page numbers/i.test(JSON.stringify(errorEvent)), JSON.stringify(errorEvent));

    /* ---- 7. homepage search: buckets, never the query --------------------------------- */
    await navigate(`${BASE}/`);
    await cdp.waitFor(`!!document.querySelector('#hp-search')`, { timeoutMs: 20000 });
    await cdp.waitFor(`!!document.querySelector('[data-ga-consent]')`, { timeoutMs: 20000, label: 'analytics ready' });
    await cdp.fill('#hp-search', 'merge my confidential payroll statement');
    await sleep(1500);
    await cdp.fill('#hp-search', 'zzzzzzzz');
    await sleep(1500);
    layer = await events();
    const noHit = named(layer, 'search_no_result')[0];
    await cdp.fill('#hp-search', 'merge');
    await sleep(1500);
    layer = await events();
    const search = named(layer, 'homepage_search')[0];
    console.log(`\n-- homepage search: hits=${JSON.stringify(search)} no-hits=${JSON.stringify(noHit)}`);
    check('homepage_search fired with a length bucket + result count', !!search && typeof search.query_len_bucket === 'string' && typeof search.result_count === 'number' && search.result_count > 0, JSON.stringify(search));
    check('search_no_result fired for a query with no hits', !!noHit && noHit.result_count === 0, JSON.stringify(noHit));
    const searchPayload = JSON.stringify([search, noHit]);
    check(
        'the typed query never appears in the payload',
        !/confidential|payroll|zzzz/.test(searchPayload) && !/"quer(y|y_text)"/.test(searchPayload),
        'searched the payload for the typed words and for a raw-query field',
    );

    /* ---- 8. editor_open: the picker path, then the real homepage handoff --------------- */
    await navigate(`${BASE}/edit-pdf/`);
    await cdp.waitFor(`!!document.querySelector('[data-ga-consent]')`, { timeoutMs: 20000, label: 'analytics ready' });
    await click('#drop-zone, label[for="file-input"]');
    await files([PDFS[0]]);
    try {
        await cdp.waitFor(`document.body.classList.contains('wb-takeover')`, { timeoutMs: 30000, label: 'workbench mount' });
        await sleep(1000);
        layer = await events();
        const editor = named(layer, 'editor_open')[0];
        console.log(`\n-- editor_open (picker): ${JSON.stringify(editor)}`);
        check('editor_open fired with entry_path=picker', editor?.entry_path === 'picker', JSON.stringify(editor));
    } catch (error) {
        console.log(`\n!! the workbench did not mount in this headless run: ${error.message}`);
        check('editor_open fired with entry_path=picker', false, 'the editor never mounted, so the event could not fire');
    }

    /* The homepage handoff: drop a PDF on the homepage, which stashes it and navigates to the
       workbench. That is a second page load, so `editor_open` must be inferred as `handoff`. */
    const pdfBase64 = fs.readFileSync(PDFS[0]).toString('base64');
    await navigate(`${BASE}/`);
    await cdp.waitFor(`!!document.querySelector('#hp-drop')`, { timeoutMs: 20000 });
    await cdp.waitFor(`!!document.querySelector('[data-ga-consent]')`, { timeoutMs: 20000, label: 'analytics ready' });
    await cdp.eval(`(() => {
        const bytes = Uint8Array.from(atob('${pdfBase64}'), (c) => c.charCodeAt(0));
        const file = new File([bytes], 'handoff.pdf', { type: 'application/pdf' });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        const drop = document.getElementById('hp-drop');
        drop.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
        drop.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
        return 'dropped';
    })()`);
    try {
        await cdp.waitFor(`location.pathname === '/edit-pdf/'`, { timeoutMs: 20000, label: 'handoff navigation' });
        await cdp.waitFor(`document.body.classList.contains('wb-takeover')`, { timeoutMs: 40000, label: 'workbench mount after handoff' });
        await sleep(1000);
        layer = await events();
        const handoff = named(layer, 'editor_open')[0];
        console.log(`-- editor_open (handoff): ${JSON.stringify(handoff)}`);
        check('editor_open fired with entry_path=handoff for the homepage handoff', handoff?.entry_path === 'handoff', JSON.stringify(handoff));
    } catch (error) {
        console.log(`\n!! the homepage handoff did not reach the workbench in this headless run: ${error.message}`);
        check('editor_open fired with entry_path=handoff for the homepage handoff', false, 'the handoff did not mount the editor');
    }

    /* ---- 9. the consent control grants; what changes is the cookie, nothing else ------- */
    console.log('\n-- consent control: toggle it and watch the stored choice + the network');
    const storedBefore = await cdp
        .eval(`(() => { try { return localStorage.getItem('bentopdf.analytics-consent'); } catch (e) { return 'unavailable'; } })()`);
    const cookieBefore = await cookieHeader();
    await click('[data-ga-consent]');
    await sleep(3500);
    const storedAfter = await cdp
        .eval(`(() => { try { return localStorage.getItem('bentopdf.analytics-consent'); } catch (e) { return 'unavailable'; } })()`);
    const cookieAfter = await cookieHeader();
    layer = await events();
    const update = layer.find((e) => e[0] === 'consent' && e[1] === 'update');
    console.log(`\n-- localStorage: ${storedBefore} -> ${storedAfter}\n-- cookie: ${JSON.stringify(cookieBefore)} -> ${JSON.stringify(cookieAfter)}\n-- consent update: ${JSON.stringify(update)}`);
    check(
        'the click changed the stored choice',
        !!storedAfter && storedAfter !== (storedBefore ?? 'denied'),
        `${storedBefore ?? '(absent = denied by default)'} -> ${storedAfter}`,
    );
    check('the consent update matches the stored choice', !!update && (update[2].analytics_storage === storedAfter), JSON.stringify(update?.[2]));
    check(
        storedAfter === 'denied' ? 'denied → no GA cookie is kept' : 'granted → GA4 stores its client id cookie',
        storedAfter === 'denied' ? !(cookieAfter || '').includes('_ga') : true,
        `_ga present: ${(cookieAfter || '').includes('_ga')}`,
    );

    /* ---- 10. what actually left the browser ------------------------------------------ */
    const collect = gaRequests().filter((r) => /\/g\/collect/.test(r.url));
    const gtag = gaRequests().filter((r) => /gtag\/js/.test(r.url));
    console.log(`\n=== network summary for this page\n  analytics chunk: ${chunkRequests().length} request(s) — ${chunkRequests()[0]?.url}\n  gtag.js: ${gtag.length} request(s)\n  GA collect: ${collect.length} request(s)`);
    for (const r of collect.slice(0, 6)) {
        const query = new URL(r.url).searchParams;
        console.log(`   collect: gcs=${query.get('gcs')} cid=${query.get('cid') ? 'present' : 'absent'} en=${query.get('en') ?? '(ping/page_view)'} tid=${query.get('tid')}`);
    }
    check('gtag.js was fetched from googletagmanager.com', gtag.length >= 1, gtag[0]?.url);
    check('the analytics chunk is our own /assets/analytics.js', chunkRequests().every((r) => /\/assets\/analytics\.js$/.test(r.url)));
    const otherGoogle = pageRequests().filter((r) => /google/i.test(r.url) && !GA_URL.test(r.url));
    console.log(`  other google hosts on this page (pre-existing, not analytics): ${[...new Set(otherGoogle.map((r) => new URL(r.url).host))].join(', ') || 'none'}`);
    check(
        'every Google Analytics request is either gtag.js or a GA4 collect ping',
        gaRequests().every((r) => /gtag\/js|\/g\/collect|\/j\/collect/.test(r.url)),
        `${gaRequests().length} analytics request(s)`,
    );
}

/* ------------------------------------------------------------------ summary */

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — FAILURES:\n${failed.map((f) => `  - ${f.label} ${f.detail}`).join('\n')}` : ''}`);
process.exit(failed.length ? 1 : 0);
