/**
 * fileGuard.ts — ONE size guard for every file-accepting entry point.
 *
 * WHY THIS EXISTS
 * ---------------
 * The site is pure client-side, so an oversized PDF does not fail gracefully: reading it
 * (`file.arrayBuffer()` / `FileReader`) is what allocates the whole document in the tab, and on a
 * large enough file that allocation — plus the tool's own copy of it — exhausts memory and the tab
 * is killed. There is no server to say "413". A size guard therefore has to run FIRST, on
 * `file.size` alone, before any entry point is allowed to read the bytes.
 *
 * DESIGN
 * ------
 *  - ZERO dependencies and NO DOM at import time: `checkFileSize` is a pure function, and `guardFile`
 *    only awaits caller-injected hooks. The whole decision surface is unit-testable in jsdom.
 *  - One exported constant table (`SIZE_THRESHOLDS`) holds every number, so tuning means editing one
 *    place. All values are BYTES (MiB = 1024*1024).
 *  - The UI (banner / confirm dialog / refusal) is NOT here: callers inject `confirm`, `onNotice` and
 *    `onBlock` (see src/js/fileGuardUi.ts for the DOM implementation). That keeps this module free of
 *    copy, styles and timers, and keeps its bytes out of any page's first load.
 *  - NOTHING here reads a file's contents. Only `file.size` / `file.name` are touched.
 *
 * TIERS
 * -----
 *  ok      → proceed silently.
 *  notice  → non-blocking: show an inline line, then proceed. NEVER blocks.
 *  warn    → requires an explicit confirmation before anything is read. The default action must not
 *            proceed on its own; `confirm` resolves false on cancel / Esc.
 *  block   → hard refusal. The caller MUST return early so the tool never starts.
 */

export type GuardTier = 'ok' | 'notice' | 'warn' | 'block';
export type DeviceClass = 'desktop' | 'mobile';

const MIB = 1024 * 1024;

/**
 * THE threshold table. Tune ONLY here.
 *
 * Mobile is deliberately stricter: a phone tab has far less memory headroom and iOS kills a tab
 * aggressively (often before a JS error can even be shown), so the same file that is a `notice` on a
 * desktop is a `warn` on a phone and the same file that is a `warn` on a desktop is a `block` there.
 */
export const SIZE_THRESHOLDS: Record<DeviceClass, { notice: number; warn: number; block: number }> = {
    desktop: { notice: 50 * MIB, warn: 150 * MIB, block: 400 * MIB },
    mobile: { notice: 20 * MIB, warn: 60 * MIB, block: 150 * MIB },
};

/**
 * The symbolic key for each non-ok tier. The UI maps these to the English source strings the i18n
 * runtime translates (see `RUNTIME_STRINGS.guard*` in src/js/i18n/runtime-strings.ts); keeping the
 * key symbolic rather than the sentence means the copy can be reworded without touching this module.
 */
export const TIER_MESSAGE_KEYS: Record<Exclude<GuardTier, 'ok'>, string> = {
    notice: 'fileGuard.notice',
    warn: 'fileGuard.warn',
    block: 'fileGuard.block',
};

export interface SizeCheck {
    tier: GuardTier;
    bytes: number;
    /** The symbolic tier key (`''` when the tier is `ok`). */
    messageKey: string;
    device: DeviceClass;
}

/**
 * Desktop vs mobile. Conservative: anything that looks like a phone/tablet — including iOS, whose
 * tabs are killed the most aggressively, and where Safari can report a desktop UA — is treated as
 * mobile so it gets the stricter thresholds.
 */
export function detectDeviceClass(): DeviceClass {
    const nav: any = typeof navigator !== 'undefined' ? navigator : undefined;
    if (nav && nav.userAgentData && typeof nav.userAgentData.mobile === 'boolean') {
        return nav.userAgentData.mobile ? 'mobile' : 'desktop';
    }
    const ua: string = (nav && nav.userAgent) || '';
    // iOS: phone UA, or iPadOS 13+ masquerading as "Macintosh" — both are tab-kill-happy.
    if (/iPhone|iPad|iPod/i.test(ua)) return 'mobile';
    const touch = nav && (nav.maxTouchPoints || 0) > 0;
    if (!touch) return 'desktop';
    let narrow = false;
    let coarse = false;
    if (typeof window !== 'undefined') {
        if (typeof window.innerWidth === 'number' && window.innerWidth > 0) narrow = window.innerWidth <= 820;
        if (typeof window.matchMedia === 'function') {
            try {
                coarse = window.matchMedia('(pointer: coarse)').matches;
            } catch {
                coarse = false;
            }
        }
    }
    // A touch device that is either narrow or pointer-coarse is a phone/tablet in all but UA.
    return narrow || coarse ? 'mobile' : 'desktop';
}

/** Pure, side-effect-free tier decision. Reads nothing but the byte count. */
export function checkFileSize(bytes: number, device: DeviceClass = detectDeviceClass()): SizeCheck {
    const t = SIZE_THRESHOLDS[device] ?? SIZE_THRESHOLDS.desktop;
    const size = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
    let tier: GuardTier = 'ok';
    if (size >= t.block) tier = 'block';
    else if (size >= t.warn) tier = 'warn';
    else if (size >= t.notice) tier = 'notice';
    return { tier, bytes: size, messageKey: tier === 'ok' ? '' : TIER_MESSAGE_KEYS[tier], device };
}

export interface GuardDetail extends SizeCheck {
    file: File;
    /** MB, one decimal, for the `{size}` placeholder. */
    sizeMb: string;
}

export interface GuardHooks {
    /** `warn` tier: must resolve `true` for the file to proceed. Default: refuse (safer). */
    confirm?: (detail: GuardDetail) => Promise<boolean> | boolean;
    /** `notice` tier: non-blocking inline line. Never affects the outcome. */
    onNotice?: (detail: GuardDetail) => void;
    /** `block` tier: the refusal explanation. The file never proceeds. */
    onBlock?: (detail: GuardDetail) => void;
    /** Override device detection (tests / callers that know better). */
    device?: DeviceClass;
}

export function describeFile(file: File, device?: DeviceClass): GuardDetail {
    const base = checkFileSize(file ? file.size : 0, device);
    return { ...base, file, sizeMb: (base.bytes / MIB).toFixed(1) };
}

/**
 * CACHE: a `warn`-tier file that the visitor already confirmed must not be asked to confirm twice —
 * the homepage drop hands the very same file to the editor page, and the editor mount re-checks a
 * file the picker already cleared. Keyed by name+size+lastModified; `block`-tier files are NEVER
 * cached, so a blocked file is refused again on every path.
 */
const confirmed = new Set<string>();
const fileKey = (file: File): string => `${file.name}|${file.size}|${(file as any).lastModified ?? 0}`;

/** Tests and long-lived pages can clear the "already confirmed" memory. */
export function resetGuardCache(): void {
    confirmed.clear();
}

/**
 * Run the guard for a single file. Resolves `true` when the caller may proceed to read/process it.
 *
 * The default `confirm` is a REFUSAL: a caller that forgets to inject a UI must not silently let a
 * warn-tier file through — the failure mode is "nothing happens", never "the tab dies".
 */
export async function guardFile(file: File, hooks: GuardHooks = {}): Promise<boolean> {
    if (!file) return false;
    const detail = describeFile(file, hooks.device);

    if (detail.tier === 'ok') return true;
    if (detail.tier === 'notice') {
        hooks.onNotice?.(detail);
        return true;
    }
    if (detail.tier === 'block') {
        hooks.onBlock?.(detail);
        return false;
    }
    // warn
    if (confirmed.has(fileKey(file))) return true;
    const ok = hooks.confirm ? await hooks.confirm(detail) : false;
    if (ok) confirmed.add(fileKey(file));
    return ok;
}

/** Every file must pass; the first refusal (or unconfirmed warn) stops the batch. */
export async function guardFiles(files: ArrayLike<File> | File[] | null | undefined, hooks: GuardHooks = {}): Promise<boolean> {
    const list = files ? Array.from(files as ArrayLike<File>) : [];
    if (!list.length) return false;
    for (const file of list) {
        if (!(await guardFile(file, hooks))) return false;
    }
    return true;
}
