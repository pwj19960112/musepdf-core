/**
 * src/js/analytics.ts — Google Tag Manager (deferred) + Consent Mode v2 in cookieless mode, plus
 * the site's privacy-safe event taxonomy.
 *
 * WHERE THE IDS COME FROM
 * -----------------------
 * `seo/site.config.json` → `analytics` is the ONE place to configure this:
 *
 *   gtmContainerId    the owner's Google Tag Manager container (e.g. `GTM-KFBJ7CK3`)
 *   ga4MeasurementId  a GA4 measurement id (optional — see "the direct-GA4 fallback" below)
 *   consentMode       `"cookieless"` (shipped) or `"full"` (cookies; needs a consent banner)
 *
 * `scripts/generate-seo-pages.mjs` writes all three into every page as
 * `<meta name="gtm-container-id">`, `<meta name="ga4-measurement-id">` and
 * `<meta name="analytics-consent-mode">`, and this module reads those tags. While BOTH ids are
 * still placeholders (`G-XXXXXXXXXX` / `GTM-XXXXXXX`) the module is a complete no-op: no `dataLayer`,
 * no `gtag` global, no script request, no cookie, no listener.
 *
 * WHY GTM AND NOT THE OLD DIRECT gtag LOADER
 * ------------------------------------------
 * The owner connected a real GTM container, so the GA4 tags (a "GA4 Configuration" tag plus a "GA4
 * Event" tag) are configured in the container UI, not by this file. Two consequences shaped the
 * implementation:
 *
 *   • With GTM, an event only triggers a tag if it is pushed as an OBJECT with an `event` KEY
 *     (`dataLayer.push({ event: 'tool_view', … })`). The gtag-style `gtag('event', …)` array does
 *     NOT create a GTM custom event, so every taxonomy event is now pushed in object form — same
 *     event names, same params, so the triggers the owner creates map 1:1.
 *   • The container is loaded with the standard GTM install (declare `dataLayer`, push
 *     `{ 'gtm.start': …, event: 'gtm.js' }`, then fetch `gtm.js?id=…`). No `<noscript>` iframe ships:
 *     it is an unconditional third-party request (fires even for a visitor who never interacts, and
 *     bypasses the idle gate) and it only serves JavaScript-disabled visitors, who by definition
 *     cannot run the tools anyway.
 *
 * A `gtag()` shim still exists, for one correct reason: `gtag('consent', 'default', {…})` is pushed
 * to the SHARED `dataLayer` before `gtm.js` is fetched, and GTM's own gtag implementation reads it.
 * No second tracker is created by that call (loading gtag.js via a separate tag is the thing that
 * creates one).
 *
 * THE DIRECT-GA4 FALLBACK (optional)
 * ----------------------------------
 * If `ga4MeasurementId` holds a real id, events are ALSO sent straight to GA4 through `gtag()` and
 * `gtag.js` is fetched, so the owner sees data before the container's tags are finished. This path is
 * off while the id is the placeholder. It must be turned off again (reset the id to the placeholder
 * and rebuild) once the container's GA4 tags are live, or every hit is counted twice.
 *
 * WHY NOTHING HERE IS IMPORTED BY A PAGE ENTRY
 * --------------------------------------------
 * Every page's first-load chunk graph is byte-for-byte unchanged. The generated HTML carries a tiny
 * inline bootstrap that wakes this module with `import('/assets/analytics.js')` only after `load` +
 * requestIdleCallback, or on the first `pointerdown`/`keydown`, whichever comes first. `dataLayer` is
 * opened and the consent default is declared by THIS module once it is woken; gtm.js is requested one
 * step later, again behind idle/interaction, so no third-party byte is on the critical path.
 *
 * CONSENT MODE v2 — COOKIELESS BY DEFAULT
 * ---------------------------------------
 * The four v2 signals (`analytics_storage`, `ad_storage`, `ad_user_data`, `ad_personalization`) are
 * pushed `denied` and NEVER granted: GA4 then collects cookieless aggregate pings and writes no
 * cookie, so no consent banner is needed for the analytics itself. There is deliberately NO consent
 * control anywhere in the UI. The `consentMode: "full"` flag would flip the defaults to `granted` for
 * a future cookie-based setup — do NOT enable it without a real EU consent banner; with cookies, one
 * becomes legally necessary.
 *
 * WHAT IS NEVER SENT
 * ------------------
 * File names, file contents, page text, raw search text, and anything that identifies a visitor's
 * document. Only coarse buckets and counts leave the browser: a file's SIZE BUCKET
 * (`<10mb` / `10-50mb` / `50-150mb` / `150-400mb` / `400mb+`), a search query's LENGTH bucket plus the
 * number of matching tool cards, and the tool slug. `src/tests/analytics.test.ts` asserts that a
 * payload never carries a file name or the typed query.
 *
 * How each event is detected is documented per `wire*()` function below; the router is
 * `initAnalytics()`.
 */
/* ------------------------------------------------------------------ config */

const GTM_META = 'gtm-container-id';
const GA4_META = 'ga4-measurement-id';
const CONSENT_MODE_META = 'analytics-consent-mode';
/** `GTM-XXXXXXX` (any run of X) means "not configured yet". */
const GTM_PLACEHOLDER = /^GTM-X+$/i;
/** `G-XXXXXXXXXX` (any run of X) means "not configured yet". */
const GA_PLACEHOLDER = /^G-X+$/i;
/** The id the previous round's consent control used; removed on boot so nothing lingers (harmless). */
const LEGACY_CONSENT_KEY = 'bentopdf.analytics-consent';
const CONSENT_SIGNALS = ['ad_storage', 'ad_user_data', 'ad_personalization', 'analytics_storage'] as const;
const GTM_SRC = 'https://www.googletagmanager.com/gtm.js?id=';
const TAG_SRC = 'https://www.googletagmanager.com/gtag/js?id=';
/** A tool that logs an error and then exports the file anyway counts as a success, not an error. */
const ERROR_GRACE_MS = 1500;

type ConsentValue = 'granted' | 'denied';
type ConsentMode = 'cookieless' | 'full';

let started = false;
let active = false;
let gtmId = '';
let ga4Id = '';
let consentMode: ConsentMode = 'cookieless';
/** Set by wireProcess(); called by wireExports() when the tool produced a file. */
let exportSuccess: () => void = () => {};

/* ------------------------------------------------------------------ pure helpers (exported for tests) */

function metaValue(name: string): string {
    const meta = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
    return (meta?.content || '').trim();
}

/** The shared dataLayer array (created by `openQueue`). */
function layer(): unknown[] {
    return (window as unknown as { dataLayer: unknown[] }).dataLayer;
}

/** The raw `gtm-container-id` meta value ('' when absent). */
export function readGtmId(): string {
    return metaValue(GTM_META);
}

/** The raw `ga4-measurement-id` meta value ('' when absent). */
export function readMeasurementId(): string {
    return metaValue(GA4_META);
}

/** `GTM-XXXXXXX`, empty, or anything that is not a GTM container id. */
export function isPlaceholderGtm(value: string): boolean {
    return !value || GTM_PLACEHOLDER.test(value);
}

/** `G-XXXXXXXXXX` (the shipped placeholder), empty, or anything that is not a GA4 id. */
export function isPlaceholderId(value: string): boolean {
    return !value || GA_PLACEHOLDER.test(value);
}

/** Size buckets — the ONLY thing about a file that is ever reported. */
export function sizeBucket(bytes: number): string {
    const mb = (Number.isFinite(bytes) && bytes > 0 ? bytes : 0) / (1024 * 1024);
    if (mb < 10) return '<10mb';
    if (mb < 50) return '10-50mb';
    if (mb < 150) return '50-150mb';
    if (mb < 400) return '150-400mb';
    return '400mb+';
}

/** Query LENGTH buckets — the raw text is never sent, only how long it was. */
export function lengthBucket(length: number): string {
    const n = Number.isFinite(length) && length > 0 ? Math.floor(length) : 0;
    if (n <= 3) return '1-3';
    if (n <= 10) return '4-10';
    if (n <= 25) return '11-25';
    return '26+';
}

/** Processing-duration buckets. */
export function durationBucket(milliseconds: number): string {
    const seconds = (Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : 0) / 1000;
    if (seconds < 1) return '<1s';
    if (seconds < 3) return '1-3s';
    if (seconds < 10) return '3-10s';
    if (seconds < 30) return '10-30s';
    if (seconds < 120) return '30-120s';
    return '120s+';
}

/** The tool this page is (its slug), or a coarse label for the pages that are not a tool. */
function pageSlug(): string {
    const id = document.body?.dataset?.tool;
    if (id) return id;
    return document.getElementById('hp-search') ? 'homepage' : 'page';
}

/* ------------------------------------------------------------------ consent */

/**
 * The consent state this build runs with: `denied` (cookieless) unless `consentMode` is `"full"`.
 * There is no visitor-facing control any more — a visitor cannot grant consent, so the site never
 * pretends they did.
 */
export function consentState(): ConsentValue {
    return consentMode === 'full' ? 'granted' : 'denied';
}

/** The four Consent Mode v2 signals, all following the one configured state. */
function consentSignals(value: ConsentValue): Record<string, ConsentValue> {
    return Object.fromEntries(CONSENT_SIGNALS.map((signal) => [signal, value]));
}

/** Drop the previous round's stored consent choice. Never writes a cookie of our own. */
function clearLegacyConsent(): void {
    try {
        localStorage.removeItem(LEGACY_CONSENT_KEY);
    } catch {
        // Private mode / storage disabled: nothing to clear.
    }
}

/* ------------------------------------------------------------------ the tag itself */

/**
 * The `gtag` shim — the same shape as Google's own snippet (`push(arguments)`), so the consent
 * default queued before gtm.js arrives is processed the moment it loads. Creating it does NOT load a
 * second tracker.
 */
function gtagStub(): void {
    const w = window as unknown as { dataLayer: unknown[] };
    w.dataLayer = w.dataLayer || [];
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer.push(arguments);
}

function send(...args: unknown[]): void {
    const fn = (window as unknown as { gtag?: (...a: unknown[]) => void }).gtag;
    if (typeof fn === 'function') fn(...args);
}

/**
 * Open the shared `dataLayer` queue and declare the consent defaults — in that order, and BEFORE any
 * network. This is the only thing that happens immediately: it is an in-memory array plus Google's
 * own stub shape, so gtm.js processes everything queued here the moment it arrives. Requests nothing,
 * sets no cookie.
 */
function openQueue(): void {
    const w = window as unknown as { gtag?: unknown; dataLayer?: unknown[] };
    w.dataLayer = w.dataLayer || [];
    if (typeof w.gtag !== 'function') w.gtag = gtagStub;
    send('consent', 'default', consentSignals(consentState()));
}

function injectScript(src: string): void {
    // Every page ships the official gtag snippet in <head> (window.__musepdfGaHead). Loading a
    // second gtag.js/gtm.js from here would configure GA4 twice and double-count page_view.
    if ((window as unknown as { __musepdfGaHead?: boolean }).__musepdfGaHead) return;
    const script = document.createElement('script');
    script.async = true;
    script.src = src;
    document.head.appendChild(script);
}

/**
 * Request the tag(s) once, with the container / GA4 config. Called only from `deferTagLoad()`, which
 * itself only runs after `load` + idle or the first interaction.
 */
function loadTags(): void {
    // The official `gtag.js` snippet now sits in every page's <head> (see generate-seo-pages.mjs,
    // GA_META). Loading gtm.js/gtag.js here as well would configure GA4 twice and double-count
    // every page_view, so this module now only pushes our event payloads onto the shared dataLayer.
    if ((window as unknown as { __musepdfGaHead?: boolean }).__musepdfGaHead) return;

    const w = window as unknown as { __musepdfAnalyticsRequested?: boolean };
    if (w.__musepdfAnalyticsRequested) return;
    w.__musepdfAnalyticsRequested = true;
    if (gtmId) {
        // The standard GTM install: announce the container, then fetch gtm.js.
        layer().push({ 'gtm.start': Date.now(), event: 'gtm.js' });
        injectScript(`${GTM_SRC}${encodeURIComponent(gtmId)}`);
    }
    if (ga4Id) {
        // Direct-GA4 fallback (see the header): a privacy-hardened gtag config plus gtag.js.
        send('js', new Date());
        send('config', ga4Id, {
            anonymize_ip: true,
            allow_google_signals: false,
            allow_ad_personalization_signals: false,
        });
        injectScript(`${TAG_SRC}${encodeURIComponent(ga4Id)}`);
    }
}

/**
 * The second half of the lazy gate: even though the bootstrap only wakes this module after idle or an
 * interaction, the tag is not requested until the browser is idle (or the visitor interacts first),
 * so a slow page never competes with the analytics download.
 */
function deferTagLoad(): void {
    let fired = false;
    const fire = () => {
        if (fired) return;
        fired = true;
        loadTags();
    };
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
        .requestIdleCallback;
    if (typeof idle === 'function') idle(fire, { timeout: 2500 });
    else window.setTimeout(fire, 2500);
    window.addEventListener('pointerdown', fire, { once: true, passive: true });
    window.addEventListener('keydown', fire, { once: true });
    window.addEventListener('scroll', fire, { once: true, passive: true });
}

/**
 * Push one event. No-ops until a container / measurement id has been configured.
 *
 * GTM reads the OBJECT form: a message with an `event` key becomes a Custom Event in the container
 * (`{{Event}}` = the name), and the params become dataLayer variables. When the direct-GA4 fallback is
 * on, the same event is also queued in gtag format so gtag.js sends it straight to GA4.
 */
export function track(event: string, params: Record<string, unknown> = {}): void {
    if (!active) return;
    layer().push({ event, ...params });
    if (ga4Id) send('event', event, params);
}


/* ---------------------------------------------------- task timing (no cookies)

   GA4's own "engagement time" is derived from `user_engagement` hits, and this site runs consent mode
   v2 cookieless (analytics_storage: denied) — those hits carry no `_et`, so the property reports 0s
   regardless of what a visitor does. These three events measure the thing we actually care about
   without asking for storage: when a task started, whether it finished, and how long it took.

   All of it is local bookkeeping plus the same `track()` path every other event uses, so it adds no
   request at load time and cannot slow a page down. */

function wireTaskTiming(slug: string): void {
    if (!slug) return;

    const started = Date.now();
    let visibleMs = 0;
    let visibleSince: number | null = document.visibilityState === 'visible' ? Date.now() : null;
    let maxScroll = 0;
    let finished = false;

    const accumulate = () => {
        if (visibleSince !== null) {
            visibleMs += Date.now() - visibleSince;
            visibleSince = null;
        }
    };

    document.addEventListener(
        'visibilitychange',
        () => {
            if (document.visibilityState === 'visible') {
                visibleSince = Date.now();
            } else {
                accumulate();
            }
        },
        { passive: true }
    );

    window.addEventListener(
        'scroll',
        () => {
            const doc = document.documentElement;
            const scrollable = doc.scrollHeight - window.innerHeight;
            const pct = scrollable > 0 ? Math.round((window.scrollY / scrollable) * 100) : 0;
            if (pct > maxScroll) maxScroll = Math.min(100, pct);
        },
        { passive: true }
    );

    window.addEventListener('musepdf:download', ((event: CustomEvent) => {
        if (finished) return; // one finish per page: a second download is the same task
        finished = true;
        const detail = event.detail || {};
        track('tool_finish', {
            tool_slug: slug,
            seconds: Math.max(1, Math.round((Date.now() - started) / 1000)),
            output_kb: Math.max(1, Math.round((Number(detail.bytes) || 0) / 1024)),
            output_type: String(detail.name || '').split('.').pop() || 'unknown',
        });
    }) as EventListener);

    const leave = () => {
        accumulate();
        track('tool_leave', {
            tool_slug: slug,
            visible_seconds: Math.max(0, Math.round(visibleMs / 1000)),
            total_seconds: Math.round((Date.now() - started) / 1000),
            scroll_pct: maxScroll,
            finished: finished ? 1 : 0,
        });
    };
    // pagehide fires on real navigations including mobile Safari; visibilitychange covers tab switches.
    window.addEventListener('pagehide', leave, { once: true });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') leave();
    });
}

/* ------------------------------------------------------------------ events */

/** `language_switch { to_lang, from_lang }` — the EN/中文 control, header or workbench. */
function wireLanguageSwitch(): void {
    document.addEventListener(
        'click',
        (event) => {
            const button = (event.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-lang]');
            if (!button) return;
            const to = button.dataset.lang === 'zh' ? 'zh' : 'en';
            const from = document.documentElement.lang.startsWith('zh') ? 'zh' : 'en';
            if (to !== from) track('language_switch', { to_lang: to, from_lang: from });
        },
        true, // before the i18n runtime's own delegated listener flips the language
    );
}

/**
 * `homepage_search { query_len_bucket, result_count }` / `search_no_result { query_len_bucket }` —
 * the homepage search field, reached by delegation (this module runs long after the page's own
 * listeners are bound). Debounced so one search is one event, and the query itself is reduced to its
 * LENGTH bucket: the typed text never leaves the page.
 */
function wireHomepageSearch(): void {
    const timers = new WeakMap<HTMLInputElement, number>();
    const searchField = (target: EventTarget | null): HTMLInputElement | null => {
        const input = target as HTMLInputElement | null;
        return input && input.matches?.('#hp-search') ? input : null;
    };

    const report = (input: HTMLInputElement) => {
        const length = input.value.trim().length;
        if (!length) return;
        const resultCount = document.querySelectorAll('.hp-card:not(.is-hidden)').length;
        const params = { query_len_bucket: lengthBucket(length), result_count: resultCount };
        track(resultCount > 0 ? 'homepage_search' : 'search_no_result', params);
    };

    document.addEventListener(
        'input',
        (event) => {
            const input = searchField(event.target);
            if (!input) return;
            window.clearTimeout(timers.get(input));
            timers.set(input, window.setTimeout(() => report(input), 800));
        },
        true,
    );
    document.addEventListener(
        'keydown',
        (event) => {
            if (event.key !== 'Enter') return;
            const input = searchField(event.target);
            if (!input) return;
            window.clearTimeout(timers.get(input));
            report(input);
        },
        true,
    );
}

/** The largest file in a selection, which is what the size bucket describes. */
function largestBytes(files: ArrayLike<File>): number {
    let bytes = 0;
    for (let i = 0; i < files.length; i++) bytes = Math.max(bytes, files[i]?.size || 0);
    return bytes;
}

/**
 * `file_selected { tool_slug, size_bucket, source }` — a file reached a tool, by the picker or by a
 * drop. Only `file.size` is read; the name, the type and the bytes themselves stay in the page.
 */
function wireFileSelection(): void {
    const report = (files: ArrayLike<File> | null | undefined, source: 'picker' | 'drop') => {
        if (!files || !files.length) return;
        track('file_selected', { tool_slug: pageSlug(), size_bucket: sizeBucket(largestBytes(files)), source });
    };

    document.addEventListener(
        'change',
        (event) => {
            const input = event.target as HTMLInputElement | null;
            if (!input || input.type !== 'file') return;
            report(input.files, 'picker');
        },
        true,
    );
    document.addEventListener(
        'drop',
        (event) => report((event as DragEvent).dataTransfer?.files, 'drop'),
        true,
    );
}

/**
 * `size_guard_shown { tier }` — the tiered size guard (src/js/fileGuardUi.ts) writes its notice line
 * and its dialogs into the DOM, so they are observed rather than called into: `notice` (inline line),
 * `warn` (confirmation dialog), `block` (refusal).
 */
function wireSizeGuard(): void {
    const seen = new WeakSet<Element>();
    const lastNoticeText = new Map<Element, string>();

    const tierOf = (node: Node | null): string | null => {
        if (!(node instanceof Element)) return null;
        if (node.matches('.fsg-dialog.fsg-warn, .fsg-warn')) return 'warn';
        if (node.matches('.fsg-dialog.fsg-block, .fsg-block')) return 'block';
        if (node.matches('#fsg-notice, .fsg-notice')) return 'notice';
        const inner = node.querySelector('.fsg-dialog.fsg-warn, .fsg-dialog.fsg-block, #fsg-notice, .fsg-notice');
        return inner ? tierOf(inner) : null;
    };

    const reportElement = (node: Node) => {
        if (!(node instanceof Element)) return;
        const tier = tierOf(node);
        const element = tier === 'notice' ? node : node.querySelector('.fsg-dialog, #fsg-notice, .fsg-notice') || node;
        if (!tier || !(element instanceof Element) || seen.has(element)) return;
        seen.add(element);
        track('size_guard_shown', { tier, tool_slug: pageSlug() });
    };

    const observer = new MutationObserver((records) => {
        for (const record of records) {
            for (const node of Array.from(record.addedNodes)) reportElement(node);
            // The notice line is REUSED for a later oversized drop, so its text changes in place.
            const target = record.target instanceof Element ? record.target : record.target.parentElement;
            const notice = target?.closest?.('.fsg-notice');
            if (!notice) continue;
            const text = (notice.textContent || '').trim();
            if (lastNoticeText.get(notice) === text) continue;
            lastNoticeText.set(notice, text);
            track('size_guard_shown', { tier: 'notice', tool_slug: pageSlug() });
        }
    });
    observer.observe(document.body ?? document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class'],
    });
}

/**
 * `process_start` / `process_success` / `process_error { tool_slug, duration_bucket, error_class }`.
 *
 * `process_start` is the click on `#process-btn` — the shared process control in every tool template.
 * A tool is then "pending" until the first of:
 *   • an EXPORT (a blob download, see wireExports) → `process_success`;
 *   • an error signal within the tool → `process_error`, classified by WHERE it surfaced:
 *     `console_error`, `uncaught_exception`, `unhandled_rejection`, or `tool_alert` (an error-titled
 *     alert dialog). The error text itself is never read out — only classified.
 * A tool that only updates the page (no download, no error) produces neither event, and a tool that
 * logs a non-fatal error and still exports is reported as a success (1.5 s grace).
 */
function wireProcess(): void {
    let pending = false;
    let startedAt = 0;
    let errorClass = '';
    let errorTimer = 0;

    const begin = () => {
        pending = true;
        startedAt = Date.now();
        errorClass = '';
        window.clearTimeout(errorTimer);
        track('process_start', { tool_slug: pageSlug() });
    };

    const succeed = () => {
        if (!pending) return;
        pending = false;
        window.clearTimeout(errorTimer);
        track('process_success', { tool_slug: pageSlug(), duration_bucket: durationBucket(Date.now() - startedAt) });
    };

    const fail = () => {
        if (!pending) return;
        pending = false;
        window.clearTimeout(errorTimer);
        track('process_error', {
            tool_slug: pageSlug(),
            duration_bucket: durationBucket(Date.now() - startedAt),
            error_class: errorClass || 'unknown',
        });
    };

    /** Record the first error signal of a running tool and arm the grace window. */
    const noteError = (cls: string) => {
        if (!pending || errorClass) return;
        errorClass = cls;
        errorTimer = window.setTimeout(fail, ERROR_GRACE_MS);
    };

    document.addEventListener(
        'click',
        (event) => {
            const button = (event.target as HTMLElement | null)?.closest?.<HTMLButtonElement>('#process-btn');
            if (!button || button.disabled) return;
            begin();
        },
        true,
    );

    window.addEventListener('error', () => noteError('uncaught_exception'));
    window.addEventListener('unhandledrejection', () => noteError('unhandled_rejection'));
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
        noteError('console_error');
        originalConsoleError.apply(console, args);
    };

    // An alert the TOOL raised: `showAlert('Error', …)` / `showAlert('Invalid Input', …)`. Observed on
    // the document (the modal is in the app shell of every tool page) and matched on our own UI
    // wording in both languages — never on a visitor's content.
    const ERROR_TITLES = /error|fail|invalid|could not|not a |wrong|错误|失败|无效|出错|无法|不(?:是|能)/i;
    let alertWasVisible = false;
    const watchAlerts = () => {
        const modal = document.getElementById('alert-modal');
        if (!modal) return;
        const visible = !modal.classList.contains('hidden');
        const wasVisible = alertWasVisible;
        alertWasVisible = visible;
        if (!visible || wasVisible) return;
        const title = (document.getElementById('alert-title')?.textContent || '').trim();
        if (ERROR_TITLES.test(title)) noteError('tool_alert');
    };
    new MutationObserver(watchAlerts).observe(document.body ?? document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
    });

    // Success is the export, which wireExports() observes; it calls back into this closure.
    exportSuccess = succeed;
}

/**
 * `export_download { tool_slug, output_size_bucket }` — every download the site triggers is an
 * `<a download>` click on a blob URL (`src/js/utils/helpers.ts#downloadFile`, jsPDF's `save()`, …).
 * The size comes from the blob we saw `URL.createObjectURL` return; when a library builds its own
 * blob without going through it, the URL is read back once, and if even that is impossible the bucket
 * is `unknown` rather than a guess.
 */
function wireExports(): void {
    const outputSizes = new Map<string, number>();
    const createObjectURL = URL.createObjectURL?.bind(URL);
    if (createObjectURL) {
        URL.createObjectURL = (source: Blob | MediaSource) => {
            const url = createObjectURL(source);
            if (typeof Blob !== 'undefined' && source instanceof Blob) outputSizes.set(url, source.size);
            return url;
        };
    }

    const report = (bytes: number) => {
        track('export_download', {
            tool_slug: pageSlug(),
            output_size_bucket: bytes >= 0 ? sizeBucket(bytes) : 'unknown',
        });
    };

    document.addEventListener(
        'click',
        (event) => {
            const anchor = (event.target as HTMLElement | null)?.closest?.<HTMLAnchorElement>('a[download]');
            if (!anchor) return;
            const href = anchor.href || '';
            const known = outputSizes.get(href);
            outputSizes.delete(href);
            exportSuccess();
            if (typeof known === 'number') {
                report(known);
                return;
            }
            if (!href.startsWith('blob:')) {
                report(-1);
                return;
            }
            fetch(href)
                .then((response) => response.blob())
                .then((blob) => report(blob.size))
                .catch(() => report(-1));
        },
        true,
    );
}

/**
 * `editor_open { entry_path }` — the workbench (Route A: /edit-pdf/, /pdf-page-dimensions/,
 * /annotate-pdf/, /stamp-pdf/, /sign-pdf/) opened a document. The entry path is inferred from what
 * happened just before: a click on the drop zone or the file field is `picker`, a drop is `drop`, and
 * a document that appears with neither was handed over by the homepage (`handoff`).
 */
const WORKBENCH_TOOLS = new Set(['edit', 'page-dimensions', 'annotate', 'stamp', 'sign-pdf']);

function wireEditorOpen(): void {
    if (!WORKBENCH_TOOLS.has(document.body?.dataset?.tool || '')) return;
    let opened = false;
    let entry: 'handoff' | 'picker' | 'drop' = 'handoff';

    document.addEventListener(
        'click',
        (event) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest?.('#drop-zone, label[for="file-input"], #file-input, [data-file-zone]')) entry = 'picker';
        },
        true,
    );
    document.addEventListener('drop', () => { entry = 'drop'; }, true);

    const check = () => {
        if (opened) return;
        const mounted =
            document.body.classList.contains('wb-takeover') ||
            !!document.querySelector('.stirling-editor-workbench[data-document-kind], #embed-pdf-container [data-document-kind]');
        if (!mounted) return;
        opened = true;
        track('editor_open', { entry_path: entry, tool_slug: pageSlug() });
    };

    // The island mounts asynchronously and announces the document on `<body>` (the takeover class)
    // and on its own container (`data-document-kind`), so both are watched.
    new MutationObserver(check).observe(document.body, {
        attributes: true,
        attributeFilter: ['class'],
        childList: true,
        subtree: true,
    });
    check();
}

/* ------------------------------------------------------------------ boot */

/**
 * Wire everything. Idempotent, and a complete no-op while BOTH ids are still placeholders:
 * nothing is created, nothing is stored, nothing is requested.
 */
export function initAnalytics(): void {
    if (started) return;
    const gtm = readGtmId();
    const ga4 = readMeasurementId();
    if (isPlaceholderGtm(gtm) && isPlaceholderId(ga4)) return;

    started = true;
    gtmId = isPlaceholderGtm(gtm) ? '' : gtm;
    ga4Id = isPlaceholderId(ga4) ? '' : ga4;
    consentMode = metaValue(CONSENT_MODE_META) === 'full' ? 'full' : 'cookieless';
    active = true;

    clearLegacyConsent();
    openQueue();
    deferTagLoad();

    // `tool_view` — one per tool page, fired as soon as the deferred module runs.
    const slug = document.body?.dataset?.tool;
    if (slug) {
        track('tool_view', { tool_slug: slug, tool_group: document.body.dataset.toolGroup || 'unknown' });
    }

    wireTaskTiming(slug || '');
    wireLanguageSwitch();
    wireHomepageSearch();
    wireFileSelection();
    wireSizeGuard();
    wireProcess();
    wireExports();
    wireEditorOpen();

    // A quiet marker in the console, so a maintainer can see at a glance whether the ids took effect.
    console.info(
        '[musepdf] analytics: ' +
            (gtmId ? `GTM ${gtmId}` : 'GTM off') +
            (ga4Id ? ` + direct GA4 ${ga4Id}` : '') +
            ` (consent mode v2, ${consentMode}: ${consentState()})`,
    );
}

/**
 * The module is only ever fetched by the deferred bootstrap in the generated HTML, so it boots
 * itself. (A test that needs a clean slate can import it and call `initAnalytics()` itself.)
 */
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initAnalytics(), { once: true });
} else {
    initAnalytics();
}
