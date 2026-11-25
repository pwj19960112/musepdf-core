/**
 * GTM verification over CDP — the raw evidence for the deferred loader, the cookieless consent
 * defaults, the event shape GTM consumes, and the optional direct-GA4 fallback.
 *
 *   node scripts/verify-gtm.mjs --cdp 9445
 *
 * Like the other verify-*.mjs scripts this ATTACHES to a Chrome you started yourself:
 *
 *   "/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new \
 *     --remote-debugging-port=9445 --user-data-dir=<scratch>/cdp-gtm --no-first-run \
 *     --no-proxy-server --disable-gpu --window-size=1400,900 --lang=en about:blank
 *
 * and it needs the preview server on http://localhost:4173 (never 127.0.0.1 — vite preview binds
 * [::1] only). It drives two states against the SAME build:
 *
 *   • shipped   — the real container (GTM-KFBJ7CK3) with the GA4 id still the placeholder.
 *   • direct-ga4 — the same page with `<meta name="ga4-measurement-id">` rewritten to a fake
 *                  `G-TEST123456` before the module boots, which turns on the direct-gtag fallback.
 */
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Cdp } from './cdp-lib.mjs';

const args = process.argv.slice(2);
const argValue = (name, fallback = null) => {
    const index = args.indexOf(name);
    return index === -1 ? fallback : args[index + 1] ?? fallback;
};
const PORT = Number(argValue('--cdp', '9445'));
const BASE = argValue('--base', 'http://localhost:4173');
const GTM_ID = argValue('--gtm', 'GTM-KFBJ7CK3');
const FAKE_GA4 = argValue('--ga4', 'G-TEST123456');
void path;

const results = [];
const check = (label, ok, detail = '') => {
    results.push({ label, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

const cdp = await Cdp.attachPage(PORT, { url: 'about:blank' });
await cdp.send('Network.enable');
await cdp.send('Page.enable');
await cdp.send('Network.clearBrowserCookies').catch(() => {});

/* ------------------------------------------------------------------ instrumentation */

let requests = [];
let loadAt = 0;
let navAt = 0;
let loaderId = null;
cdp.onMessage((message) => {
    if (message.method === 'Network.requestWillBeSent') {
        requests.push({ url: message.params.request.url, at: Date.now(), loaderId: message.params.loaderId });
    }
    if (message.method === 'Page.loadEventFired' && Date.now() >= navAt) loadAt = Date.now();
});

const reset = () => {
    requests = [];
    loadAt = 0;
    navAt = Date.now();
};
const navigate = async (url) => {
    reset();
    const { loaderId: id } = await cdp.send('Page.navigate', { url });
    loaderId = id;
    await cdp.waitFor('document.readyState === "complete"', { timeoutMs: 30000, label: `load ${url}` });
};
const pageRequests = () => requests.filter((r) => !loaderId || r.loaderId === loaderId);
const GA_URL = /googletagmanager\.com|google-analytics\.com/;
const gtmRequests = () => pageRequests().filter((r) => /googletagmanager\.com\/gtm\.js/.test(r.url));
const gtagRequests = () => pageRequests().filter((r) => /googletagmanager\.com\/gtag\/js/.test(r.url));
const analyticsChunk = () => pageRequests().filter((r) => /\/assets\/analytics\.js/.test(r.url));

/** The dataLayer as an object: GTM-shaped `{event}` messages and gtag-shaped command arrays. */
const LAYER = `JSON.stringify({
  events: (window.dataLayer || []).filter((e) => e && typeof e === 'object' && typeof e.event === 'string'),
  commands: (window.dataLayer || [])
    .filter((e) => e && typeof e === 'object' && typeof e.event !== 'string' && typeof e.length === 'number')
    .map((e) => Array.from(e)),
})`;
const layer = async () => JSON.parse(await cdp.eval(LAYER));
const event = (l, name) => l.events.find((e) => e.event === name);
const command = (l, name, action) => l.commands.find((c) => c[0] === name && (action === undefined || c[1] === action));

/* ================================================================== state: shipped */

console.log(`\n=== state: shipped container ${GTM_ID} (GA4 id still the placeholder) ===`);
await navigate(`${BASE}/merge-pdf/`);
const loadStamp = loadAt;
await cdp.waitFor('!!(window.dataLayer || []).some((a) => a && a.event === "tool_view")', {
    timeoutMs: 20000,
    label: 'tool_view after idle',
});
await sleep(1500);
{
    const before = pageRequests().filter((r) => loadStamp && r.at < loadStamp && (GA_URL.test(r.url) || /\/assets\/analytics\.js/.test(r.url)));
    check('nothing on the critical path: no analytics request (chunk or third party) before Page.loadEventFired', before.length === 0, before.length ? JSON.stringify(before.map((r) => r.url)) : `0 of ${pageRequests().length} requests`);
    const chunk = analyticsChunk();
    if (chunk.length && loadStamp) check('the loader chunk is fetched after Page.loadEventFired', chunk[0].at >= loadStamp, `+${chunk[0].at - loadStamp}ms`);
    const gtm = gtmRequests();
    check(`gtm.js is requested with the real container id`, gtm.length >= 1 && gtm[0].url.includes(`id=${GTM_ID}`), gtm[0]?.url ?? 'none');
    if (gtm.length && loadStamp) check('gtm.js is requested after Page.loadEventFired (idle/interaction gate)', gtm[0].at >= loadStamp, `+${gtm[0].at - loadStamp}ms`);
    check('no gtag.js request while the GA4 id is the placeholder', gtagRequests().length === 0, `${gtagRequests().length} request(s)`);
    const thirdParty = pageRequests().filter((r) => /googletagmanager\.com/.test(r.url));
    check('every googletagmanager.com request is gtm.js or gtag/js', thirdParty.every((r) => /gtm\.js|gtag\/js/.test(r.url)), thirdParty.map((r) => r.url.split('?')[0]).join(', '));

    const l = await layer();
    const consent = command(l, 'consent', 'default');
    check('consent default is declared denied (all four v2 signals)', !!consent && consent[2].analytics_storage === 'denied' && consent[2].ad_storage === 'denied' && consent[2].ad_user_data === 'denied' && consent[2].ad_personalization === 'denied', JSON.stringify(consent?.[2]));
    const start = event(l, 'gtm.js');
    check('the container is announced with the documented gtm.start/gtm.js message', !!start && typeof start['gtm.start'] === 'number', JSON.stringify(start));
    const tv = event(l, 'tool_view');
    // gtm.js decorates each processed push with `gtm.uniqueEventId`, so assert the fields, not equality.
    check('tool_view is pushed in the GTM object shape', !!tv && tv.event === 'tool_view' && tv.tool_slug === 'merge' && tv.tool_group === 'Merge & Split', JSON.stringify(tv));

    const cookie = await cdp.eval('document.cookie');
    check('document.cookie stays empty (cookieless mode)', cookie === '', cookie || '(empty)');
    const ui = await cdp.eval(`JSON.stringify({ consent: !!document.querySelector('[data-ga-consent]'), labels: !!document.querySelector('[data-ga-labels]') })`);
    const parsedUi = JSON.parse(ui);
    check('no consent control and no label island is rendered', parsedUi.consent === false && parsedUi.labels === false, ui);

    const gcs = pageRequests().find((r) => /google-analytics\.com\/g\/collect/.test(r.url));
    if (gcs) {
        const q = new URL(gcs.url).searchParams;
        console.log(`   note: a cookieless collect ping was seen (gcs=${q.get('gcs')}, cid=${q.get('cid') ?? 'absent'}) — consent mode v2's contract, not a bug`);
    } else {
        console.log('   note: no GA collection request at all (the container has no GA tags configured yet)');
    }
}

/* ================================================================== state: direct GA4 fallback */

console.log(`\n=== state: direct-GA4 fallback (ga4-measurement-id rewritten to ${FAKE_GA4}) ===`);
await cdp.send('Network.clearBrowserCookies').catch(() => {});
const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source:
        'new MutationObserver(function () {' +
        '  var m = document.querySelector(\'meta[name="ga4-measurement-id"]\');' +
        `  if (m && m.getAttribute('content') !== '${FAKE_GA4}') m.setAttribute('content', '${FAKE_GA4}');` +
        '}).observe(document, { childList: true, subtree: true });',
});
await navigate(`${BASE}/merge-pdf/`);
const loadStamp2 = loadAt;
await cdp.waitFor(`!!(window.dataLayer || []).some((a) => a && a.event === "tool_view")`, { timeoutMs: 20000, label: 'tool_view after idle' });
await sleep(2000);
{
    const before = pageRequests().filter((r) => loadStamp2 && r.at < loadStamp2 && GA_URL.test(r.url));
    check('still nothing third-party before Page.loadEventFired', before.length === 0, before.length ? JSON.stringify(before.map((r) => r.url)) : '0 requests');
    const gtag = gtagRequests();
    check(`gtag.js is requested with the fake measurement id`, gtag.length >= 1 && gtag[0].url.includes(`id=${FAKE_GA4}`), gtag[0]?.url ?? 'none');
    check('gtm.js is still requested alongside it', gtmRequests().length >= 1, gtmRequests()[0]?.url ?? 'none');
    const l = await layer();
    check('the gtag js + config commands are queued', !!command(l, 'js') && command(l, 'config')?.[1] === FAKE_GA4, JSON.stringify(command(l, 'config')));
    check('tool_view is also queued in gtag command form', JSON.stringify(command(l, 'event', 'tool_view')?.[2]) === '{"tool_slug":"merge","tool_group":"Merge & Split"}', JSON.stringify(command(l, 'event', 'tool_view')));
    const cookie = await cdp.eval('document.cookie');
    check('document.cookie stays empty in the fallback too', cookie === '', cookie || '(empty)');
}
await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }).catch(() => {});

/* ------------------------------------------------------------------ summary */

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — FAILURES:\n${failed.map((f) => `  - ${f.label} ${f.detail}`).join('\n')}` : ''}`);
await cdp.close();
process.exit(failed.length ? 1 : 0);
