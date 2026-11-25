/**
 * Unit tests for the tiered file-size guard (src/js/fileGuard.ts).
 *
 * The boundaries are asserted at the exact byte (49/50/149/150/399/400 MiB on desktop and
 * 19/20/59/60/149/150 MiB on mobile) because a `>=` that drifts to `>` would silently move the whole
 * ladder — and the guard is the last thing standing between an oversized PDF and a killed tab.
 *
 * `guardFile`'s confirm/cancel contract is exercised with an injected stub, which is exactly why the
 * module keeps its UI out: the decision surface is testable without a browser or a DOM.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    SIZE_THRESHOLDS,
    TIER_MESSAGE_KEYS,
    checkFileSize,
    detectDeviceClass,
    guardFile,
    guardFiles,
    describeFile,
    resetGuardCache,
} from '../js/fileGuard';

const MiB = 1024 * 1024;

/** A minimal File stand-in: the guard only ever reads `size`, `name` and `lastModified`. */
const file = (bytes: number, name = 'doc.pdf'): File =>
    ({ name, size: bytes, lastModified: 1 } as unknown as File);

const NO_HOOKS = {} as const;

beforeEach(() => {
    resetGuardCache();
});

describe('SIZE_THRESHOLDS', () => {
    it('exposes one tunable table with the documented desktop/mobile numbers', () => {
        expect(SIZE_THRESHOLDS.desktop).toEqual({ notice: 50 * MiB, warn: 150 * MiB, block: 400 * MiB });
        expect(SIZE_THRESHOLDS.mobile).toEqual({ notice: 20 * MiB, warn: 60 * MiB, block: 150 * MiB });
    });
});

describe('checkFileSize — desktop boundaries', () => {
    const t = (mb: number) => checkFileSize(mb * MiB, 'desktop');

    it('49 MB is ok, 50 MB is notice (exact lower bound)', () => {
        expect(t(49).tier).toBe('ok');
        expect(t(50).tier).toBe('notice');
    });

    it('149 MB is still notice, 150 MB becomes warn (exact lower bound)', () => {
        expect(t(149).tier).toBe('notice');
        expect(t(150).tier).toBe('warn');
    });

    it('399 MB is still warn, 400 MB becomes block (exact lower bound)', () => {
        expect(t(399).tier).toBe('warn');
        expect(t(400).tier).toBe('block');
    });

    it('honours the byte immediately below each boundary', () => {
        expect(checkFileSize(50 * MiB - 1, 'desktop').tier).toBe('ok');
        expect(checkFileSize(150 * MiB - 1, 'desktop').tier).toBe('notice');
        expect(checkFileSize(400 * MiB - 1, 'desktop').tier).toBe('warn');
    });

    it('reports bytes, device and messageKey', () => {
        const r = checkFileSize(200 * MiB, 'desktop');
        expect(r).toMatchObject({ tier: 'warn', bytes: 200 * MiB, device: 'desktop', messageKey: TIER_MESSAGE_KEYS.warn });
        expect(checkFileSize(1 * MiB, 'desktop').messageKey).toBe('');
    });
});

describe('checkFileSize — mobile boundaries (stricter)', () => {
    const t = (mb: number) => checkFileSize(mb * MiB, 'mobile');

    it('19/20 MB split ok/notice', () => {
        expect(t(19).tier).toBe('ok');
        expect(t(20).tier).toBe('notice');
    });

    it('59/60 MB split notice/warn', () => {
        expect(t(59).tier).toBe('notice');
        expect(t(60).tier).toBe('warn');
    });

    it('149/150 MB split warn/block', () => {
        expect(t(149).tier).toBe('warn');
        expect(t(150).tier).toBe('block');
    });

    it('a 100 MB file is a single-step-higher tier on mobile than on desktop', () => {
        expect(checkFileSize(100 * MiB, 'desktop').tier).toBe('notice');
        expect(checkFileSize(100 * MiB, 'mobile').tier).toBe('warn');
        expect(checkFileSize(300 * MiB, 'desktop').tier).toBe('warn');
        expect(checkFileSize(300 * MiB, 'mobile').tier).toBe('block');
    });

    it('treats a non-finite / negative size as ok (never blocks on a bad number)', () => {
        expect(checkFileSize(Number.NaN, 'desktop').tier).toBe('ok');
        expect(checkFileSize(-5, 'desktop').tier).toBe('ok');
    });
});

describe('detectDeviceClass', () => {
    const restore = { ua: '', uaData: undefined as unknown };

    beforeEach(() => {
        const nav = navigator as any;
        restore.ua = nav.userAgent;
        restore.uaData = nav.userAgentData;
        delete nav.userAgentData;
        Object.defineProperty(nav, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (Windows NT 10.0)' });
        Object.defineProperty(nav, 'maxTouchPoints', { configurable: true, value: 0 });
    });

    it('trusts userAgentData.mobile when the browser provides it', () => {
        Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: { mobile: true } });
        expect(detectDeviceClass()).toBe('mobile');
        Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: { mobile: false } });
        expect(detectDeviceClass()).toBe('desktop');
    });

    it('treats iOS UAs as mobile even without userAgentData', () => {
        Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' });
        expect(detectDeviceClass()).toBe('mobile');
        Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPad; CPU OS 17_0)' });
        expect(detectDeviceClass()).toBe('mobile');
    });

    it('a non-touch desktop UA is desktop', () => {
        expect(detectDeviceClass()).toBe('desktop');
    });
});

describe('guardFile — tier contract', () => {
    it('ok tier proceeds, with no hook called', async () => {
        const onNotice = vi.fn();
        const confirm = vi.fn();
        const onBlock = vi.fn();
        await expect(guardFile(file(10 * MiB), { device: 'desktop', onNotice, confirm, onBlock })).resolves.toBe(true);
        expect(onNotice).not.toHaveBeenCalled();
        expect(confirm).not.toHaveBeenCalled();
        expect(onBlock).not.toHaveBeenCalled();
    });

    it('notice tier calls onNotice and STILL proceeds (non-blocking)', async () => {
        const onNotice = vi.fn();
        const confirm = vi.fn();
        await expect(guardFile(file(100 * MiB), { device: 'desktop', onNotice, confirm })).resolves.toBe(true);
        expect(onNotice).toHaveBeenCalledTimes(1);
        expect(confirm).not.toHaveBeenCalled();
    });

    it('warn tier proceeds only when confirm resolves true', async () => {
        const confirm = vi.fn().mockResolvedValue(true);
        await expect(guardFile(file(200 * MiB), { device: 'desktop', confirm })).resolves.toBe(true);
        expect(confirm).toHaveBeenCalledTimes(1);
    });

    it('warn tier refuses when confirm resolves false (cancel)', async () => {
        const confirm = vi.fn().mockResolvedValue(false);
        await expect(guardFile(file(200 * MiB), { device: 'desktop', confirm })).resolves.toBe(false);
    });

    it('warn tier with NO confirm hook refuses — the default action never proceeds', async () => {
        await expect(guardFile(file(200 * MiB), { device: 'desktop', ...NO_HOOKS })).resolves.toBe(false);
    });

    it('block tier calls onBlock and refuses', async () => {
        const onBlock = vi.fn();
        await expect(guardFile(file(500 * MiB), { device: 'desktop', onBlock })).resolves.toBe(false);
        expect(onBlock).toHaveBeenCalledTimes(1);
    });
});

describe('guardFile — confirm memory', () => {
    it('a confirmed warn file is not asked again on a second path', async () => {
        const confirm = vi.fn().mockResolvedValue(true);
        const f = file(200 * MiB, 'same.pdf');
        await expect(guardFile(f, { device: 'desktop', confirm })).resolves.toBe(true);
        await expect(guardFile(f, { device: 'desktop', confirm })).resolves.toBe(true);
        expect(confirm).toHaveBeenCalledTimes(1);
    });

    it('a CANCELLED warn file is asked again (nothing was remembered)', async () => {
        const confirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        const f = file(200 * MiB, 'same.pdf');
        await expect(guardFile(f, { device: 'desktop', confirm })).resolves.toBe(false);
        await expect(guardFile(f, { device: 'desktop', confirm })).resolves.toBe(true);
        expect(confirm).toHaveBeenCalledTimes(2);
    });

    it('a block-tier file is NEVER remembered — refused on every path', async () => {
        const onBlock = vi.fn();
        const f = file(500 * MiB, 'huge.pdf');
        await expect(guardFile(f, { device: 'desktop', onBlock })).resolves.toBe(false);
        await expect(guardFile(f, { device: 'desktop', onBlock })).resolves.toBe(false);
        expect(onBlock).toHaveBeenCalledTimes(2);
    });
});

describe('guardFiles — batch', () => {
    it('resolves true when every file passes', async () => {
        await expect(guardFiles([file(10 * MiB), file(11 * MiB)], { device: 'desktop' })).resolves.toBe(true);
    });

    it('stops on the first refusal and resolves false', async () => {
        const onBlock = vi.fn();
        const later = file(10 * MiB, 'later.pdf');
        await expect(
            guardFiles([file(10 * MiB, 'a.pdf'), file(500 * MiB, 'big.pdf'), later], { device: 'desktop', onBlock })
        ).resolves.toBe(false);
        expect(onBlock).toHaveBeenCalledTimes(1);
    });

    it('an empty batch resolves false (nothing to process)', async () => {
        await expect(guardFiles([], { device: 'desktop' })).resolves.toBe(false);
    });
});

describe('describeFile', () => {
    it('carries the file and a one-decimal MB figure for the copy', () => {
        const detail = describeFile(file(Math.round(152.3 * MiB)), 'desktop');
        expect(detail.sizeMb).toBe('152.3');
        expect(detail.tier).toBe('warn');
    });
});
