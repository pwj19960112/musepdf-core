import { setupToolInterface } from './handlers/toolSelectionHandler.js';
import { initI18n } from './i18n/init.js';

/**
 * Entry point for the generated SEO landing pages.
 *
 * Each page declares its tool with `<body data-tool="merge">`. The page loads the same
 * tool machinery as the single-page app (ui.ts + toolSelectionHandler.ts) and mounts only
 * that one tool, so the page itself is the tool: no upload, no redirect, no iframe.
 *
 * No lucide call here on purpose: the generated markup draws its icons as inline SVG, and the tool
 * template's `data-lucide` placeholders are converted by `setupToolInterface` right after it injects
 * them. Running `createIcons` before that would be dead work — and would keep the whole icon set in
 * this chunk instead of the one that actually needs it.
 *
 * `initI18n` here is what makes the EN/中文 control in the generated header work; it is tiny and pulls
 * the Chinese dictionary only when Chinese is actually selected.
 *
 * FIRST-LOAD SIZE, reported honestly: this import stays static, and it is NOT the only thing keeping the
 * runtime in the tool pages' first load. There is a second, non-obvious edge —
 * `toolSelectionHandler.ts` -> `ui.ts` -> `i18n/init.ts`, which ui.ts needs for `tr()` on the loader and
 * alert copy — so making THIS one dynamic does not remove the chunk: Vite still emits it as a script tag
 * on every tool page (measured: the median went 289.4 -> 289.7 KB gzip, i.e. it only added the
 * bootstrap's own bytes). Moving `ui.ts` off the runtime is the prerequisite for any real reduction.
 */
const boot = () => {
    initI18n();

    const toolId = document.body.dataset.tool;
    // Every generated page carries data-tool; a page that does not is not a tool page.
    if (!toolId) return;

    try {
        setupToolInterface(toolId);
    } catch (error) {
        console.error(`landing.ts: could not open tool "${toolId}"`, error);
        const panel = document.getElementById('tool-interface');
        if (panel) {
            panel.insertAdjacentHTML(
                'afterbegin',
                '<p style="color:#fca5a5">This tool failed to load in your browser. Please try a different browser or report the issue.</p>'
            );
        }
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
