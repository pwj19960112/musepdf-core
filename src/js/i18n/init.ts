/**
 * Site-wide EN / 中文 — two pre-rendered page sets, one runtime dictionary.
 *
 * WHY THIS SHAPE
 * --------------
 * Both languages are real, crawlable URLs: `/merge-pdf/` is English and `/zh/merge-pdf/` is Chinese,
 * each served from its own static HTML (see scripts/generate-seo-pages.mjs). So the header control is
 * NAVIGATION between the two page sets, not a DOM swap — `<a data-lang="zh" href="/zh/...">` — and it
 * works with JavaScript disabled. `data-page-lang` on `<html>` (written by the generator) declares
 * which set this page is, and it is authoritative: a `/zh/` page is Chinese whatever the browser
 * prefers, and the canonical of an English page never claims to be Chinese.
 *
 * The dictionary (`/i18n/zh.json`, written by scripts/make-zh-dictionary.mjs) still exists, because a
 * Chinese page contains copy that is injected AFTER first paint: the tool templates in src/js/ui.ts,
 * the app grid, the drop-zone chips. On a `/zh/` page the runtime therefore loads it and translates
 * those subtrees in place; on an English page it is never fetched, so the English first load is
 * unchanged. It is keyed by the English source string (whitespace-normalised), so a key cannot drift
 * from the copy it translates.
 *
 * The same normalisation is what the build-time renderer uses to produce the Chinese HTML, so the
 * static page and the runtime agree on every string.
 *
 * Only standalone TEXT NODES are rewritten (never `innerHTML`), so the markup stays byte-identical,
 * inline links keep working, and icon+text spans such as `<span><svg/> No upload</span>` translate too.
 * Engine-owned subtrees (`[data-i18n-skip]`: the React workbench island), script/style/template
 * content and code/pre blocks are skipped — those renderers ship their own bilingual strings.
 *
 * The lookup key is the WHITESPACE-NORMALISED text (`norm`), exactly what the extractor in
 * scripts/make-zh-dictionary.mjs used to key the dictionary and what `tr` uses. Trimming alone is not
 * enough: a paragraph whose HTML source wraps across lines carries an internal newline + indent, so a
 * trim-only key would never match its own dictionary entry and the copy would silently stay English.
 *
 * English is restored from the text captured just before the swap, and only while the node still holds
 * what this module wrote, so copy a script updated in the meantime is never clobbered.
 */

export type Lang = 'en' | 'zh';

type Dict = { strings?: Record<string, string>; attrs?: Record<string, string> };

const STORAGE_KEY = 'bentopdf.lang';
const DICT_URL = '/i18n/zh.json';
/** Attributes that are visible or announced to assistive tech. */
const ATTRS = ['placeholder', 'aria-label', 'title'] as const;
/** Sub-trees whose copy belongs to another renderer (or is not copy at all). */
const SKIP_SELECTOR = 'script, style, noscript, template, code, pre, [data-i18n-skip]';
/**
 * A string with no letter in any alphabet is language-neutral — a lone "," or "150" or "★☆☆☆☆" reads
 * the same in English and Chinese. Those never get a dictionary entry, and this guard keeps a stray
 * punctuation text node from ever picking one up. (Texts split apart by inline markup are a real case:
 * `Producer</strong>, <strong>CreationDate` leaves a text node that is just a comma.)
 */
const HAS_LETTER = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/;

let dict: Dict | null = null;
let loading: Promise<void> | null = null;
let lang: Lang = 'en';
let started = false;
let observer: MutationObserver | null = null;

const listeners = new Set<(lang: Lang) => void>();
/** English text of every node this module touched, and the Chinese it wrote (for a safe restore). */
const nodeOrig = new Map<Text, string>();
const nodeShown = new Map<Text, string>();
const attrOrig = new Map<Element, Map<string, string>>();
const attrShown = new Map<Element, Map<string, string>>();

const norm = (value: string): string => value.replace(/\s+/g, ' ').trim();
const edges = (value: string): RegExpExecArray | null => /^(\s*)([\s\S]*?)(\s*)$/.exec(value);

/** Active language. */
export const getLang = (): Lang => lang;

/** Subscribe to language changes (used by the React workbench island). */
export function onLang(callback: (lang: Lang) => void): () => void {
    listeners.add(callback);
    return () => {
        listeners.delete(callback);
    };
}

/** Translate a runtime-composed string (inline English default when the dictionary is not loaded). */
export function tr(en: string): string {
    if (lang !== 'zh' || !dict) return en;
    return (dict.strings ?? {})[norm(en)] ?? en;
}

/** Fetch the Chinese dictionary once; resolves immediately when it is already in memory. */
export function ensureDict(): Promise<void> {
    if (dict) return Promise.resolve();
    if (!loading) {
        loading = fetch(DICT_URL)
            .then((response) => (response.ok ? response.json() : {}))
            .then((body) => {
                dict = body && typeof body === 'object' ? (body as Dict) : {};
            })
            .catch(() => {
                // An offline visitor keeps the English copy rather than a half-swapped page.
                dict = {};
            });
    }
    return loading;
}

function swapAttrs(root: Node): void {
    const attrs = dict?.attrs ?? {};
    const zh = lang === 'zh';
    const scope = (root instanceof Element || root instanceof Document ? root : document) as ParentNode;
    for (const el of Array.from(scope.querySelectorAll<HTMLElement>('*'))) {
        if (el.closest('[data-i18n-skip]')) continue;
        for (const name of ATTRS) {
            const value = el.getAttribute(name);
            if (value === null) continue;
            let originals = attrOrig.get(el);
            if (!originals) {
                originals = new Map();
                attrOrig.set(el, originals);
            }
            let shown = attrShown.get(el);
            if (!shown) {
                shown = new Map();
                attrShown.set(el, shown);
            }
            if (zh) {
                if (!originals.has(name)) originals.set(name, value);
                const translated = attrs[norm(originals.get(name) as string)];
                if (translated === undefined) continue;
                shown.set(name, translated);
                if (value !== translated) el.setAttribute(name, translated);
            } else {
                const original = originals.get(name);
                if (original !== undefined && shown.get(name) === value) el.setAttribute(name, original);
            }
        }
    }
}

/** Swap (or restore) the copy of a subtree in place: text nodes only, markup untouched. */
export function apply(root: Node = document.body ?? document.documentElement): void {
    const strings = dict?.strings ?? {};
    const zh = lang === 'zh';
    const walker = document.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        const parent = node.parentElement;
        if (!parent || parent.closest(SKIP_SELECTOR)) continue;
        const raw = node.data;
        const edge = edges(raw);
        if (!edge) continue;
        const head = edge[1];
        const core = edge[2];
        const tail = edge[3];
        if (!core) continue;
        // The dictionary is keyed by whitespace-normalised copy (see scripts/make-zh-dictionary.mjs).
        // Collapsing internal runs matters: a wrapped paragraph's text node contains a newline + indent.
        const key = norm(core);
        // Language-neutral text (numbers, punctuation, symbols) has no dictionary entry to find.
        if (!HAS_LETTER.test(key)) continue;
        if (zh) {
            const translated = strings[key];
            if (translated === undefined) continue;
            if (!nodeOrig.has(node)) nodeOrig.set(node, raw);
            const next = `${head}${translated}${tail}`;
            nodeShown.set(node, next);
            if (raw !== next) node.data = next;
        } else {
            const original = nodeOrig.get(node);
            if (original === undefined || node.data !== nodeShown.get(node)) continue;
            node.data = original;
        }
    }
    swapAttrs(root);
}

/** Copy the runtime also swaps when a script (re)renders a subtree after boot. */
function watch(): void {
    if (observer) return;
    observer = new MutationObserver((records) => {
        for (const record of records) {
            for (const added of Array.from(record.addedNodes)) {
                if (added instanceof Element) apply(added);
            }
        }
    });
    observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
}

function paintToggles(): void {
    for (const control of Array.from(document.querySelectorAll<HTMLElement>('[data-lang]'))) {
        const active = control.dataset.lang === lang;
        control.setAttribute('aria-current', active ? 'page' : 'false');
        control.classList.toggle('is-active', active);
    }
}

function notify(): void {
    for (const callback of Array.from(listeners)) callback(lang);
}

/** Switch language, persist the choice and re-render the copy that is already on the page. */
export async function setLang(next: Lang): Promise<void> {
    lang = next;
    try {
        localStorage.setItem(STORAGE_KEY, next);
    } catch {
        // Private mode / storage disabled: the choice just does not survive the session.
    }
    if (next === 'zh') {
        await ensureDict();
    } else if (observer) {
        observer.disconnect();
        observer = null;
    }
    document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en';
    paintToggles();
    apply();
    notify();
    if (next === 'zh') {
        watch();
        // A page that renders copy after first paint (a tool panel) catches up here.
        if (document.readyState !== 'complete') {
            window.addEventListener('load', () => apply(), { once: true });
        }
        requestAnimationFrame(() => apply());
    }
}

function storedLang(): Lang | null {
    try {
        const value = localStorage.getItem(STORAGE_KEY);
        return value === 'zh' || value === 'en' ? value : null;
    } catch {
        return null;
    }
}

/** Wire the toggle(s) and apply the page's language. Idempotent. */
export function initI18n(): void {
    if (started) return;
    started = true;

    // The page's own language wins: the generator declares it on every page it owns, so a pre-rendered
    // /zh/ page stays Chinese for an English browser, and an English page is never half-swapped into
    // Chinese by a stale preference. A page that declares nothing falls back to the stored choice (then
    // to the browser's own language).
    //
    // NO click handler: the header control is a pair of real links between the two page sets, so a
    // click is ordinary navigation. `setLang` stays exported because the workbench's own switch calls
    // it directly — there the document is already open, so switching cannot be a navigation.
    const declared = document.documentElement.dataset.pageLang;
    lang = declared === 'zh' || declared === 'en'
        ? declared
        : storedLang() ?? ((navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en');
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    paintToggles();

    if (lang === 'zh') {
        // A Chinese page still has copy injected after first paint (the tool panel, the app grid), so
        // the dictionary is loaded and applied to those subtrees. English pages never fetch it.
        void setLang('zh');
    } else {
        apply();
        notify();
    }
}
