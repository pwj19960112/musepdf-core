/**
 * With BOTH ids still placeholders (`GTM-XXXXXXX` / `G-XXXXXXXXXX`, the shape `seo/site.config.json`
 * uses for an unconfigured slot) the analytics module must be a complete no-op: no `dataLayer`, no
 * `gtag` global, no script request, no cookie, no localStorage write, no consent control.
 *
 * This lives in its own file on purpose: the module self-initialises on import, so the assertion is
 * only meaningful in a module registry that has never seen a real id.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const FOOTER =
    '<footer class="hp-footer"><div class="hp-footer-bottom"><span class="hp-footer-legal">© 2026 MusePDF.</span>' +
    '<ul><li><a href="/about.html">About</a></li></ul></div></footer>';

describe('analytics with placeholder ids', () => {
    beforeEach(() => {
        document.head.innerHTML =
            '<meta name="gtm-container-id" content="GTM-XXXXXXX">' +
            '<meta name="ga4-measurement-id" content="G-XXXXXXXXXX">' +
            '<meta name="analytics-consent-mode" content="cookieless">';
        document.body.innerHTML = FOOTER;
        try {
            window.localStorage.clear();
        } catch {
            /* jsdom storage is always available; the module guards for private mode anyway */
        }
    });

    it('requests nothing, stores nothing and renders no control', async () => {
        vi.resetModules();
        const analytics = await import('@/js/analytics');
        analytics.initAnalytics();

        expect(analytics.readGtmId()).toBe('GTM-XXXXXXX');
        expect(analytics.readMeasurementId()).toBe('G-XXXXXXXXXX');
        expect(analytics.isPlaceholderGtm('GTM-XXXXXXX')).toBe(true);
        expect(analytics.isPlaceholderGtm('')).toBe(true);
        expect(analytics.isPlaceholderGtm('GTM-KFBJ7CK3')).toBe(false);
        expect(analytics.isPlaceholderId('G-XXXXXXXXXX')).toBe(true);
        expect(analytics.isPlaceholderId('')).toBe(true);
        expect(analytics.isPlaceholderId('G-TEST123456')).toBe(false);

        expect((window as any).dataLayer).toBeUndefined();
        expect((window as any).gtag).toBeUndefined();
        expect(document.querySelector('script[src*="googletagmanager"]')).toBeNull();
        expect(document.querySelector('[data-ga-consent]')).toBeNull();
        expect(document.cookie).toBe('');
        expect(window.localStorage.getItem('bentopdf.analytics-consent')).toBeNull();
    });

    it('stays inert when the meta tags are missing altogether', async () => {
        document.head.innerHTML = '';
        vi.resetModules();
        const analytics = await import('@/js/analytics');
        analytics.initAnalytics();

        expect(analytics.readGtmId()).toBe('');
        expect(analytics.readMeasurementId()).toBe('');
        expect((window as any).dataLayer).toBeUndefined();
        expect(document.querySelector('[data-ga-consent]')).toBeNull();
    });
});
