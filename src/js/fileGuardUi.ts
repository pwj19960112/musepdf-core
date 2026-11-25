/**
 * fileGuardUi.ts — the DOM half of the size guard.
 *
 * `src/js/fileGuard.ts` decides the tier and stays UI-free; this module supplies the three hooks it
 * calls (`onNotice`, `confirm`, `onBlock`) plus the one-shot `guardFilesWithUi` every entry point
 * uses. It is deliberately a SEPARATE, dynamically-imported module: it pulls `i18n/init` and builds
 * DOM, so its bytes must not ride along on any page's first load.
 *
 * Accessibility: the confirm and refusal dialogs are `role="alertdialog"` with `aria-modal`, an
 * accessible name and description, focus moved into the dialog, a Tab trap, and Esc = cancel. The
 * notice is a non-blocking `role="status"` line — it never steals focus and never stops the tool.
 *
 * Localisation: every string is composed through `tr()` (i18n/init.ts), keyed by the English source
 * strings in `RUNTIME_STRINGS.guard*`; `{name}` and `{size}` are substituted AFTER translation so word
 * order follows the target language.
 */
import { tr } from './i18n/init.js';
import { RUNTIME_STRINGS } from './i18n/runtime-strings.js';
import { guardFiles, type GuardDetail, type GuardHooks } from './fileGuard.js';

const S = RUNTIME_STRINGS;

/** Translate the template, then substitute the placeholders (so EN/中文 word order both read right). */
function fill(template: string, detail: GuardDetail): string {
    return tr(template).replace('{name}', detail.file.name).replace('{size}', detail.sizeMb);
}

/** Where an inline notice belongs on each entry point's page, most specific first. */
const NOTICE_ANCHORS = ['file-display-area', 'compare-upload-area', 'hp-drop-chips', 'tool-content'];

function noticeAnchor(): HTMLElement | null {
    for (const id of NOTICE_ANCHORS) {
        const el = document.getElementById(id);
        if (el) return el;
    }
    return null;
}

/**
 * `notice` tier: a single, non-blocking inline line. Reused (not stacked) so a multi-file drop shows
 * one line, and it never removes or blocks the tool.
 */
export function showNotice(detail: GuardDetail): void {
    const id = 'fsg-notice';
    let el = document.getElementById(id) as HTMLElement | null;
    if (!el) {
        el = document.createElement('div');
        el.id = id;
        el.className = 'fsg-banner fsg-notice';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        const anchor = noticeAnchor();
        if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(el, anchor);
        else document.body.appendChild(el);
    }
    el.textContent = fill(S.guardNoticeLine, detail);
}

function trapFocus(dialog: HTMLElement): () => void {
    const onKey = (event: KeyboardEvent) => {
        if (event.key !== 'Tab') return;
        const focusables = Array.from(
            dialog.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
        ).filter((el) => !el.hasAttribute('disabled'));
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (event.shiftKey && active === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
        }
    };
    dialog.addEventListener('keydown', onKey);
    return () => dialog.removeEventListener('keydown', onKey);
}

/**
 * Build a modal `alertdialog`, focus the SAFE control (Cancel/Close, never the destructive one) and
 * resolve with the button the visitor picked; Esc and the backdrop resolve `false`.
 */
function openDialog(opts: {
    variant: 'warn' | 'block';
    title: string;
    body: string;
    actions: Array<{ label: string; value: boolean; primary?: boolean; danger?: boolean }>;
}): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        const previouslyFocused = document.activeElement as HTMLElement | null;

        const overlay = document.createElement('div');
        overlay.className = 'fsg-overlay';

        const dialog = document.createElement('div');
        dialog.className = `fsg-dialog fsg-${opts.variant}`;
        dialog.setAttribute('role', 'alertdialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'fsg-dialog-title');
        dialog.setAttribute('aria-describedby', 'fsg-dialog-body');

        const title = document.createElement('h2');
        title.id = 'fsg-dialog-title';
        title.className = 'fsg-dialog-title';
        title.textContent = opts.title;

        const body = document.createElement('p');
        body.id = 'fsg-dialog-body';
        body.className = 'fsg-dialog-body';
        body.textContent = opts.body;

        const actions = document.createElement('div');
        actions.className = 'fsg-dialog-actions';

        const buttons = opts.actions.map((action) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'fsg-btn' + (action.primary ? ' fsg-btn-primary' : '') + (action.danger ? ' fsg-btn-danger' : '');
            button.textContent = action.label;
            button.addEventListener('click', () => finish(action.value));
            return button;
        });
        actions.append(...buttons);

        dialog.append(title, body, actions);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        // The SAFE control gets focus, so a stray Enter cancels rather than proceeding.
        const safe = buttons.find((button, i) => opts.actions[i].value === false) ?? buttons[0];
        safe?.focus();

        const detachTrap = trapFocus(dialog);
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                finish(false);
            }
        };
        document.addEventListener('keydown', onKey, true);
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) finish(false);
        });

        let done = false;
        function finish(value: boolean) {
            if (done) return;
            done = true;
            document.removeEventListener('keydown', onKey, true);
            detachTrap();
            overlay.remove();
            previouslyFocused?.focus?.();
            resolve(value);
        }
    });
}

/** `warn` tier: must be explicitly confirmed. Cancel / Esc resolves `false` and nothing is read. */
export function confirmWarn(detail: GuardDetail): Promise<boolean> {
    return openDialog({
        variant: 'warn',
        title: tr(S.guardWarnTitle),
        body: fill(S.guardWarnBody, detail),
        actions: [
            { label: tr(S.guardWarnCancel), value: false },
            { label: tr(S.guardWarnConfirm), value: true, danger: true },
        ],
    });
}

/** `block` tier: refuse, with a plain reason and the split/compress suggestion. Resolves `false`. */
export function showBlock(detail: GuardDetail): Promise<boolean> {
    return openDialog({
        variant: 'block',
        title: tr(S.guardBlockTitle),
        body: fill(S.guardBlockBody, detail),
        actions: [{ label: tr(S.guardBlockClose), value: false, primary: true }],
    }).then(() => false);
}

/** The DOM hooks `guardFile`/`guardFiles` call. */
export function uiHooks(): GuardHooks {
    return { confirm: confirmWarn, onNotice: showNotice, onBlock: showBlock };
}

/**
 * Guard a batch of files with the site's banner/dialog UI. Resolves `true` only when every file may
 * proceed; `false` means the caller MUST return early and start nothing.
 */
export function guardFilesWithUi(files: ArrayLike<File> | File[] | null | undefined): Promise<boolean> {
    return guardFiles(files, uiHooks());
}
