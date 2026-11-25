/**
 * Unit tests for src/js/analytics.ts — the GTM loader, Cookieless Consent Mode v2 and the event
 * taxonomy.
 *
 * Three things are being protected here:
 *
 *   1. THE BUCKETS. Every payload is a bucket or a count, so the bucket boundaries ARE the privacy
 *      contract: a `<10mb` that drifts to `<=10mb` would start describing a file rather than a class
 *      of file. The boundaries are asserted at the exact byte.
 *   2. THE REDACTION. `file_selected` must never carry a file name and `homepage_search` must never
 *      carry the typed query — both are asserted against the serialised payload, not just the fields
 *      the implementation happens to set today.
 *   3. THE GTM SHAPE. A GTM custom event only fires when the message is a dataLayer OBJECT with an
 *      `event` KEY — the gtag `['event', …]` array does not trigger anything. So the taxonomy is
 *      asserted in object form, and the `gtm.start`/`js`/`config` commands in their own shapes.
 *
 * The module self-initialises on import, and it only leaves its inert path when at least one id is
 * real — so this file imports it once (no `<meta>` yet = no-op) and then activates it in `beforeAll`
 * with the shipped container id, exactly like the real build.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Node 26's jsdom run has no webstorage, and the module deliberately reads the global `localStorage`
 * inside a try/catch, so persistence is asserted against a stub.
 */
const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
        getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
        setItem: (key: string, value: string) => {
            store.set(key, String(value));
        },
        removeItem: (key: string) => {
            store.delete(key);
        },
        clear: () => store.clear(),
    },
});

const FAKE_GTM = 'GTM-KFBJ7CK3';
const FAKE_GA4 = 'G-TEST123456';

const FOOTER =
    '<footer class="hp-footer"><div class="hp-footer-bottom"><span class="hp-footer-legal">© 2026 MusePDF.</span>' +
    '<ul><li><a href="/about.html">About</a></li><li><a href="/privacy.html">Privacy</a></li></ul></div></footer>';

const analytics = await import('@/js/analytics');

const raw = (): any[] => ((window as any).dataLayer || []) as any[];

/** GTM-shaped messages: plain objects with an `event` key (`{event: 'tool_view', …}`). */
function gtmEvents(name?: string): any[] {
    return raw().filter((e) => e && typeof e === 'object' && typeof e.event === 'string' && (name === undefined || e.event === name));
}

/** gtag-shaped commands: the array-like messages `gtag()` pushes (`['event', 'x', {…}]`). */
const isCommand = (entry: any): boolean =>
    !!entry && typeof entry === 'object' && typeof entry.event !== 'string' && typeof entry.length === 'number';

function command(name: string, action?: string): unknown[] | undefined {
    for (const entry of raw()) {
        if (!isCommand(entry)) continue;
        const arr = Array.from(entry as ArrayLike<unknown>);
        if (arr[0] === name && (action === undefined || arr[1] === action)) return arr;
    }
    return undefined;
}

/** Snapshot in `beforeAll`, right after activation — the dataLayer is reset between tests. */
let activationLayer: any[] = [];

/** A File stand-in whose `size` is set directly — nothing ever reads the bytes. */
function fakeFile(name: string, bytes: number): File {
    const file = new File([new Uint8Array(1)], name, { type: 'application/pdf' });
    Object.defineProperty(file, 'size', { value: bytes });
    return file;
}

describe('analytics buckets', () => {
    it('size buckets match the shipped tiers', () => {
        const MiB = 1024 * 1024;
        expect(analytics.sizeBucket(0)).toBe('<10mb');
        expect(analytics.sizeBucket(9 * MiB)).toBe('<10mb');
        expect(analytics.sizeBucket(10 * MiB)).toBe('10-50mb');
        expect(analytics.sizeBucket(50 * MiB - 1)).toBe('10-50mb');
        expect(analytics.sizeBucket(50 * MiB)).toBe('50-150mb');
        expect(analytics.sizeBucket(150 * MiB - 1)).toBe('50-150mb');
        expect(analytics.sizeBucket(150 * MiB)).toBe('150-400mb');
        expect(analytics.sizeBucket(400 * MiB - 1)).toBe('150-400mb');
        expect(analytics.sizeBucket(400 * MiB)).toBe('400mb+');
    });

    it('query length is bucketed, never reported', () => {
        expect(analytics.lengthBucket(0)).toBe('1-3');
        expect(analytics.lengthBucket(1)).toBe('1-3');
        expect(analytics.lengthBucket(3)).toBe('1-3');
        expect(analytics.lengthBucket(4)).toBe('4-10');
        expect(analytics.lengthBucket(10)).toBe('4-10');
        expect(analytics.lengthBucket(11)).toBe('11-25');
        expect(analytics.lengthBucket(25)).toBe('11-25');
        expect(analytics.lengthBucket(26)).toBe('26+');
    });

    it('duration is bucketed', () => {
        expect(analytics.durationBucket(0)).toBe('<1s');
        expect(analytics.durationBucket(999)).toBe('<1s');
        expect(analytics.durationBucket(1000)).toBe('1-3s');
        expect(analytics.durationBucket(3000)).toBe('3-10s');
        expect(analytics.durationBucket(10000)).toBe('10-30s');
        expect(analytics.durationBucket(30000)).toBe('30-120s');
        expect(analytics.durationBucket(120000)).toBe('120s+');
    });

    it('recognises the shipped placeholders', () => {
        expect(analytics.isPlaceholderGtm('')).toBe(true);
        expect(analytics.isPlaceholderGtm('GTM-XXXXXXX')).toBe(true);
        expect(analytics.isPlaceholderGtm(FAKE_GTM)).toBe(false);
        expect(analytics.isPlaceholderId('')).toBe(true);
        expect(analytics.isPlaceholderId('G-XXXXXXXXXX')).toBe(true);
        expect(analytics.isPlaceholderId(FAKE_GA4)).toBe(false);
    });
});

describe('analytics with the shipped GTM container', () => {
    beforeAll(() => {
        document.head.innerHTML =
            `<meta name="gtm-container-id" content="${FAKE_GTM}">` +
            '<meta name="ga4-measurement-id" content="G-XXXXXXXXXX">' +
            '<meta name="analytics-consent-mode" content="cookieless">';
        document.body.innerHTML = FOOTER;
        document.body.dataset.tool = 'merge';
        document.body.dataset.toolGroup = 'Merge & Split';
        // jsdom has no createObjectURL; the module wraps whatever it finds, so exports can be sized.
        let n = 0;
        (URL as any).createObjectURL = () => `blob:musepdf/${++n}`;
        analytics.initAnalytics();
        activationLayer = raw().slice();
    });

    beforeEach(() => {
        (window as any).dataLayer = [];
    });

    it('declares consent denied before anything is requested, and renders no consent control', () => {
        expect(analytics.readGtmId()).toBe(FAKE_GTM);
        expect((window as any).dataLayer).toBeDefined();
        const consentDefault = activationLayer.find((e) => isCommand(e) && e[0] === 'consent' && e[1] === 'default');
        expect(consentDefault[2]).toEqual({
            ad_storage: 'denied',
            ad_user_data: 'denied',
            ad_personalization: 'denied',
            analytics_storage: 'denied',
        });
        // No consent UI of any kind, and no gtag.js instance for the container path.
        expect(document.querySelector('[data-ga-consent]')).toBeNull();
        expect(document.querySelector('script[src*="gtag/js"]')).toBeNull();
        expect(analytics.consentState()).toBe('denied');
        expect(document.cookie).toBe('');
    });

    it('reports the tool page view as a GTM object message, after the consent default', () => {
        const view = activationLayer.find((e) => e?.event === 'tool_view');
        expect(view).toEqual({ event: 'tool_view', tool_slug: 'merge', tool_group: 'Merge & Split' });
        expect(activationLayer.findIndex((e) => isCommand(e) && e[0] === 'consent')).toBeLessThan(
            activationLayer.findIndex((e) => e?.event === 'tool_view'),
        );
    });

    it('drops the previous round\u2019s stored consent choice (harmless cleanup)', () => {
        expect(window.localStorage.getItem('bentopdf.analytics-consent')).toBeNull();
    });

    it('requests gtm.js — and nothing else — only when the loader is woken', () => {
        expect(document.querySelector('script[src*="googletagmanager"]')).toBeNull();
        window.dispatchEvent(new Event('pointerdown'));
        const scripts = document.querySelectorAll<HTMLScriptElement>('script[src*="googletagmanager"]');
        expect(scripts).toHaveLength(1);
        expect(scripts[0].src).toBe(`https://www.googletagmanager.com/gtm.js?id=${FAKE_GTM}`);
        expect(scripts[0].async).toBe(true);
        // The container is announced with the documented gtm.start/gtm.js message.
        const gtmStart = gtmEvents('gtm.js')[0];
        expect(gtmStart).toBeTruthy();
        expect(typeof gtmStart['gtm.start']).toBe('number');
        // No direct GA4 tag is fetched while the measurement id is the placeholder.
        expect(document.querySelector('script[src*="gtag/js"]')).toBeNull();
    });

    it('reports file_selected with a size bucket and never the file name', () => {
        const file = fakeFile('Payroll-2026-Confidential.pdf', 60 * 1024 * 1024);
        const drop = new Event('drop', { bubbles: true, cancelable: true });
        Object.defineProperty(drop, 'dataTransfer', { value: { files: [file] } });
        document.dispatchEvent(drop);

        const [event] = gtmEvents('file_selected');
        expect(event).toEqual({ event: 'file_selected', tool_slug: 'merge', size_bucket: '50-150mb', source: 'drop' });
        expect(JSON.stringify(event)).not.toContain('Payroll');
    });

    it('reports the picker path too, and only buckets the largest file of a batch', () => {
        const input = document.createElement('input');
        input.type = 'file';
        Object.defineProperty(input, 'files', {
            value: [fakeFile('a.pdf', 1024), fakeFile('b.pdf', 12 * 1024 * 1024)],
        });
        document.body.appendChild(input);
        input.dispatchEvent(new Event('change', { bubbles: true }));

        const [event] = gtmEvents('file_selected');
        expect(event).toEqual({ event: 'file_selected', tool_slug: 'merge', size_bucket: '10-50mb', source: 'picker' });
    });

    it('buckets the homepage query instead of sending it', async () => {
        vi.useFakeTimers();
        document.body.innerHTML =
            '<input id="hp-search" type="search">' +
            '<a class="hp-card" href="/merge-pdf/">Merge</a>' +
            '<a class="hp-card is-hidden" href="/crop-pdf/">Crop</a>';
        const input = document.getElementById('hp-search') as HTMLInputElement;

        input.value = 'merge pdf';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await vi.advanceTimersByTimeAsync(900);

        const [search] = gtmEvents('homepage_search');
        expect(search).toEqual({ event: 'homepage_search', query_len_bucket: '4-10', result_count: 1 });
        expect(JSON.stringify(search)).not.toContain('merge pdf');

        // No card matches → the dedicated no-result event, still without the query.
        (window as any).dataLayer = [];
        document.querySelectorAll('.hp-card').forEach((card) => card.classList.add('is-hidden'));
        input.value = 'zz';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await vi.advanceTimersByTimeAsync(900);

        const [empty] = gtmEvents('search_no_result');
        expect(empty).toEqual({ event: 'search_no_result', query_len_bucket: '1-3', result_count: 0 });
        expect(gtmEvents('homepage_search')).toHaveLength(0);
        vi.useRealTimers();
    });

    it('reports process_start, then process_success + export_download when the tool exports', () => {
        document.body.insertAdjacentHTML('beforeend', '<button id="process-btn">Merge PDFs</button>');
        (document.getElementById('process-btn') as HTMLButtonElement).click();
        expect(gtmEvents('process_start')[0]).toMatchObject({ event: 'process_start', tool_slug: 'merge' });

        // What `downloadFile()` does: mint a blob URL, click an `<a download>`.
        const blob = new Blob([new Uint8Array(2 * 1024 * 1024)]);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'merged.pdf';
        document.body.appendChild(anchor);
        anchor.click();

        expect(gtmEvents('process_success')[0]).toMatchObject({ event: 'process_success', tool_slug: 'merge', duration_bucket: '<1s' });
        expect(gtmEvents('export_download')[0]).toEqual({ event: 'export_download', tool_slug: 'merge', output_size_bucket: '<10mb' });
    });

    it('reports process_error with an error class, and never the error text', async () => {
        vi.useFakeTimers();
        (window as any).dataLayer = [];
        document.body.insertAdjacentHTML('beforeend', '<button id="process-btn">Merge PDFs</button>');
        (document.getElementById('process-btn') as HTMLButtonElement).click();

        console.error('boom: /Users/secret/statement.pdf could not be parsed');
        await vi.advanceTimersByTimeAsync(1600);
        vi.useRealTimers();

        const [error] = gtmEvents('process_error');
        expect(error).toMatchObject({ event: 'process_error', tool_slug: 'merge', error_class: 'console_error' });
        expect(JSON.stringify(error)).not.toContain('statement.pdf');
    });

    it('reports size_guard_shown for the tier the guard wrote into the DOM', async () => {
        const overlay = document.createElement('div');
        overlay.className = 'fsg-overlay';
        overlay.innerHTML = '<div class="fsg-dialog fsg-warn"><h2>Large file — continue?</h2></div>';
        document.body.appendChild(overlay);
        await Promise.resolve();

        const [guard] = gtmEvents('size_guard_shown');
        expect(guard).toEqual({ event: 'size_guard_shown', tier: 'warn', tool_slug: 'merge' });
    });
});

describe('analytics with a real GA4 measurement id (the direct-gtag fallback)', () => {
    it('loads gtag.js and queues js/config + a duplicate event command', async () => {
        document.head.innerHTML =
            `<meta name="gtm-container-id" content="${FAKE_GTM}">` +
            `<meta name="ga4-measurement-id" content="${FAKE_GA4}">` +
            '<meta name="analytics-consent-mode" content="cookieless">';
        document.body.innerHTML = FOOTER;
        document.body.dataset.tool = 'merge';
        document.body.dataset.toolGroup = 'Merge & Split';
        (window as any).dataLayer = [];
        // The "requested once" guard lives on `window`; clear it so this fresh instance can fire.
        delete (window as any).__musepdfAnalyticsRequested;
        vi.resetModules();
        const fresh = await import('@/js/analytics');
        fresh.initAnalytics();

        // tool_view is now pushed in BOTH shapes: the GTM object and the gtag command for GA4.
        expect(gtmEvents('tool_view')[0]).toMatchObject({ event: 'tool_view', tool_slug: 'merge' });

        expect(document.querySelectorAll('script[src*="googletagmanager"]').length).toBe(0);
        window.dispatchEvent(new Event('pointerdown'));
        const after = document.querySelectorAll<HTMLScriptElement>('script[src*="googletagmanager"]');
        expect(after.length).toBe(2);
        const sources = [...after].map((s) => s.src).sort();
        expect(sources).toEqual([
            `https://www.googletagmanager.com/gtag/js?id=${FAKE_GA4}`,
            `https://www.googletagmanager.com/gtm.js?id=${FAKE_GTM}`,
        ]);
        expect(command('config')![1]).toBe(FAKE_GA4);
        expect(command('js')).toBeTruthy();
        expect(command('event', 'tool_view')![2]).toEqual({ tool_slug: 'merge', tool_group: 'Merge & Split' });
    });
});
