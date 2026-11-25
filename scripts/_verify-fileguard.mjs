/**
 * Real-browser check for the tiered file-size guard, over raw CDP against the running preview
 * (http://localhost:4173). Run with a local headless Chrome already listening on the given port.
 *
 *   node scripts/_verify-fileguard.mjs 9352
 *
 * Proves, end to end: a small file passes silently; a ~150 MB file shows the warn dialog and the page
 * does NOT proceed until it is confirmed, and cancelling (= Esc) leaves the tool untouched; the
 * homepage drop path shows the SAME hint as the tool page; the block tier refuses and never starts a
 * tool (picker AND homepage handoff); the notice tier is non-blocking; and the copy renders in 中文.
 */
import { Cdp } from './cdp-lib.mjs';

const PORT = process.argv[2] ?? '9352';
const BASE = 'http://localhost:4173';
const MB = 1024 * 1024;

// An 855-byte valid 1-page PDF, so the "small file" case actually parses and the tool really proceeds.
const SMALL_PDF_B64 =
    'JVBERi0xLjcKJYGBgYEKCjYgMCBvYmoKPDwKL0ZpbHRlciAvRmxhdGVEZWNvZGUKL0xlbmd0aCAxMDAKPj4Kc3RyZWFtCnicK+RyCuEyUADBonQufY/UnLLUkszkRF1zA0sLEwsDcwtLBUMThZA0LiMg6cNlCFZqqGAEJAwMFEJyuWxMLMxMzZyB0M3IwMzc3NTM0NzIzMROISSLK0SLyzWEK5ALALm7FncKZW5kc3RyZWFtCmVuZG9iagoKNyAwIG9iago8PAovRmlsdGVyIC9GbGF0ZURlY29kZQovVHlwZSAvT2JqU3RtCi9OIDUKL0ZpcnN0IDI2Ci9MZW5ndGggMzYxCj4+CnN0cmVhbQp4nNVSTUvDQBC976+Yox5kP/KxiZRC2yQKUpRWUBQPabKUSNmVZCv13zuTpJYexLOEYXdm3uy8yTwJAhSEIQSgEwghChREoKWEyYTxx68PA/yh3JqO8bum7uAVMQJW8Mb4wu2tB8mmU3bCLkpf7tyWDUUgCXxEPLSu3lemhUmRF4UQWggRh2ixECrDc4GWoin0MacSvKPpcDSM6UCIYIa5YrBYDzWU77HRWJ/jidiYMNmADZPB/+lLvfLhDfUXn3TK+NLVWekNXGTXSqhYSqmwYRrFL5f4O1pTevd/h+v5N87+OuHZnmm9tOTWkAb6LfOV6dy+rXDthCscZuhya3afxjdVeaVFmiBPnaSosVEY/Pl+826qHkpufvA3a08chgDFlqZuyrk7oPoEfjg5IGvS4Mxa50mVvR6tRzbkxaNGzygTIcbX+43vXQpKxudlZ3qqJ55IwlaubuwW+FNjZ7ZrjgF68RswDsXoCmVuZHN0cmVhbQplbmRvYmoKCjggMCBvYmoKPDwKL1NpemUgOQovUm9vdCAyIDAgUgovSW5mbyAzIDAgUgovRmlsdGVyIC9GbGF0ZURlY29kZQovVHlwZSAvWFJlZgovTGVuZ3RoIDQwCi9XIFsgMSAyIDIgXQovSW5kZXggWyAwIDkgXQo+PgpzdHJlYW0KeJwVxLERACAMA7G3wx0tg7MSsyVYhYBusyEpOVVa4oB4P18YYS4DlAplbmRzdHJlYW0KZW5kb2JqCgpzdGFydHhyZWYKNjUyCiUlRU9G';

const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok: Boolean(ok) });
    console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ` | ${detail}` : ''}`);
};

const HELPERS = `
window.__fg = {
  stub(size, name, type = 'application/pdf') { const f = new File([new Uint8Array(1024)], name, { type, lastModified: 7 }); Object.defineProperty(f, 'size', { value: size }); return f; },
  real(b64, name, type = 'application/pdf') { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new File([u], name, { type, lastModified: 7 }); },
  inject(sel, file) { const input = document.querySelector(sel); if (!input) return 'no-input'; const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); return 'ok'; },
  drop(sel, files) { const el = document.querySelector(sel); if (!el) return 'no-drop'; const dt = new DataTransfer(); files.forEach((f) => dt.items.add(f)); const ev = new DragEvent('drop', { bubbles: true, cancelable: true }); Object.defineProperty(ev, 'dataTransfer', { value: dt }); el.dispatchEvent(ev); return 'ok'; },
  overlayText() { const o = document.querySelector('.fsg-overlay'); return o ? o.innerText : null; },
  dialogRole() { const d = document.querySelector('.fsg-dialog'); return d ? d.getAttribute('role') : null; },
  ariaModal() { const d = document.querySelector('.fsg-dialog'); return d ? d.getAttribute('aria-modal') : null; },
  active() { return document.activeElement ? document.activeElement.textContent : null; },
  fileDisplay() { const e = document.getElementById('file-display-area'); return e ? e.textContent.trim() : '__none__'; },
  banner() { const b = document.querySelector('.fsg-banner'); return b ? b.textContent : null; },
  clickDialog(label) { const b = [...document.querySelectorAll('.fsg-dialog button')].find((x) => x.textContent === label); if (!b) return 'no-btn'; b.click(); return 'ok'; },
  clickDialogIndex(i) { const b = document.querySelectorAll('.fsg-dialog button')[i]; if (!b) return 'no-btn'; b.click(); return 'ok'; },
  dialogButtons() { return [...document.querySelectorAll('.fsg-dialog button')].map((b) => b.textContent); },
  splitOptionsHidden() { const e = document.getElementById('split-options'); return e ? e.classList.contains('hidden') : '__none__'; },
};
'ok'`;

const cdp = await Cdp.attachPage(PORT);
// A fresh Chrome profile can carry a language choice from an earlier run; force EN so the assertions are deterministic.
await cdp.goto(BASE + '/');
await cdp.eval("localStorage.setItem('bentopdf.lang', 'en'); 'ok'");
const goto = async (path) => {
    await cdp.goto(`${BASE}${path}`);
    await cdp.eval(HELPERS);
};
const esc = async () => {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await new Promise((r) => setTimeout(r, 200));
};
const noOverlay = () => cdp.eval(`!document.querySelector('.fsg-overlay')`);

try {
    // ---------------------------------------------------------------- S1: small file passes silently
    await goto('/split-pdf/');
    await cdp.waitFor(`document.querySelector('#file-input') ? 1 : 0`, { label: 'file input' });
    await cdp.eval(`window.__fg.inject('#file-input', window.__fg.real(${JSON.stringify(SMALL_PDF_B64)}, 'small-valid.pdf'))`);
    await cdp.waitFor(`window.__fg.fileDisplay().indexOf('small-valid.pdf') !== -1 ? 1 : 0`, { timeoutMs: 8000, label: 'small file display' });
    check('S1 small file passes silently (no dialog, no banner)', (await noOverlay()) && (await cdp.eval(`window.__fg.banner()`)) === null);
    check('S1 small file is accepted and the tool opens', (await cdp.eval(`window.__fg.fileDisplay()`)).includes('small-valid.pdf') && (await cdp.eval(`window.__fg.splitOptionsHidden()`)) === false, `total-pages=${await cdp.eval(`document.getElementById('total-pages')?.textContent`)}`);

    // ---------------------------------------------------------------- S2: 150 MB warn on a tool page
    await goto('/split-pdf/');
    await cdp.waitFor(`document.querySelector('#file-input') ? 1 : 0`, { label: 'file input' });
    await cdp.eval(`window.__fg.inject('#file-input', window.__fg.stub(${150 * MB}, 'big.pdf'))`);
    await cdp.waitFor(`document.querySelector('.fsg-overlay') ? 1 : 0`, { timeoutMs: 8000, label: 'warn overlay' });
    const warnText = await cdp.eval(`window.__fg.overlayText()`);
    check('S2 warn dialog appears for a 150 MB file', /big\.pdf/.test(warnText) && /150\.0 MB/.test(warnText), JSON.stringify(warnText.replace(/\n+/g, ' / ')));
    check('S2 warn dialog is an alertdialog (aria-modal)', (await cdp.eval(`window.__fg.dialogRole()`)) === 'alertdialog' && (await cdp.eval(`window.__fg.ariaModal()`)) === 'true');
    const warnButtons = await cdp.eval(`window.__fg.dialogButtons()`);
    check('S2 focus is moved into the dialog (safe default = Cancel)', (await cdp.eval(`window.__fg.active()`)) === warnButtons[0], `active=${await cdp.eval(`window.__fg.active()`)}`);
    check('S2 the tool does NOT proceed while the dialog is open', (await cdp.eval(`window.__fg.fileDisplay()`)) === '' && (await cdp.eval(`window.__fg.splitOptionsHidden()`)) === true);

    await esc();
    check('S2 Esc cancels the dialog', await noOverlay());
    check('S2 cancelling leaves the tool untouched', (await cdp.eval(`window.__fg.fileDisplay()`)) === '' && (await cdp.eval(`window.__fg.splitOptionsHidden()`)) === true);

    await cdp.eval(`window.__fg.inject('#file-input', window.__fg.stub(${150 * MB}, 'big.pdf'))`);
    await cdp.waitFor(`document.querySelector('.fsg-overlay') ? 1 : 0`, { timeoutMs: 8000, label: 'warn overlay again' });
    await cdp.eval(`window.__fg.clickDialogIndex(1)`);
    await cdp.waitFor(`!document.querySelector('.fsg-overlay') ? 1 : 0`, { timeoutMs: 8000, label: 'overlay closed on confirm' });
    await cdp.waitFor(`window.__fg.fileDisplay().indexOf('big.pdf') !== -1 ? 1 : 0`, { timeoutMs: 8000, label: 'proceeded after confirm' });
    check('S2 confirming lets the page proceed (tool starts)', (await cdp.eval(`window.__fg.fileDisplay()`)).includes('big.pdf'));

    // ---------------------------------------------------------------- S3: homepage drop shows the same hint
    await goto('/');
    await cdp.waitFor(`document.querySelector('#hp-drop') ? 1 : 0`, { label: 'hp drop' });
    await cdp.eval(`window.__fg.drop('#hp-drop', [window.__fg.stub(${150 * MB}, 'big.pdf')])`);
    await cdp.waitFor(`document.querySelector('.fsg-overlay') ? 1 : 0`, { timeoutMs: 8000, label: 'homepage warn overlay' });
    const homeWarn = await cdp.eval(`window.__fg.overlayText()`);
    check('S3 homepage drop path shows the SAME warn hint', /big\.pdf/.test(homeWarn) && /150\.0 MB/.test(homeWarn), JSON.stringify(homeWarn.replace(/\n+/g, ' / ')));
    check('S3 homepage does not navigate while the dialog is open', (await cdp.eval('location.pathname')) === '/');
    await esc();
    check('S3 homepage cancel stays put and stashes nothing', (await cdp.eval('location.pathname')) === '/' && (await cdp.eval(`document.getElementById('hp-drop-chips').hidden`)) === true);

    // ---------------------------------------------------------------- S4: block tier refuses (picker)
    await goto('/split-pdf/');
    await cdp.waitFor(`document.querySelector('#file-input') ? 1 : 0`, { label: 'file input' });
    await cdp.eval(`window.__fg.inject('#file-input', window.__fg.stub(${450 * MB}, 'huge.pdf'))`);
    await cdp.waitFor(`document.querySelector('.fsg-overlay') ? 1 : 0`, { timeoutMs: 8000, label: 'block overlay' });
    const blockText = await cdp.eval(`window.__fg.overlayText()`);
    check('S4 block dialog refuses a 450 MB file with a reason + suggestion', /huge\.pdf/.test(blockText) && /450\.0 MB/.test(blockText) && /split or compress/i.test(blockText), JSON.stringify(blockText.replace(/\n+/g, ' / ')));
    check('S4 block dialog focus = Close (the only action)', (await cdp.eval(`window.__fg.dialogButtons()`)).length === 1 && (await cdp.eval(`window.__fg.active()`)) === (await cdp.eval(`window.__fg.dialogButtons()`))[0]);
    await cdp.eval(`window.__fg.clickDialogIndex(0)`);
    await cdp.waitFor(`!document.querySelector('.fsg-overlay') ? 1 : 0`, { timeoutMs: 8000, label: 'block closed' });
    check('S4 a block-tier file can NOT start the tool (picker path)', (await cdp.eval(`window.__fg.fileDisplay()`)) === '' && (await cdp.eval(`window.__fg.splitOptionsHidden()`)) === true);

    // ---------------------------------------------------------------- S5: block tier can not start via the handoff
    await goto('/');
    await cdp.waitFor(`document.querySelector('#hp-drop') ? 1 : 0`, { label: 'hp drop' });
    await cdp.eval(`window.__fg.drop('#hp-drop', [window.__fg.stub(${450 * MB}, 'huge.pdf')])`);
    await cdp.waitFor(`document.querySelector('.fsg-overlay') ? 1 : 0`, { timeoutMs: 8000, label: 'homepage block overlay' });
    await cdp.eval(`window.__fg.clickDialogIndex(0)`);
    await cdp.waitFor(`!document.querySelector('.fsg-overlay') ? 1 : 0`, { timeoutMs: 8000, label: 'homepage block closed' });
    check('S5 a block-tier file can NOT start a tool via the homepage handoff', (await cdp.eval('location.pathname')) === '/');

    // ---------------------------------------------------------------- S6: notice tier is non-blocking
    await goto('/split-pdf/');
    await cdp.waitFor(`document.querySelector('#file-input') ? 1 : 0`, { label: 'file input' });
    await cdp.eval(`window.__fg.inject('#file-input', window.__fg.stub(${60 * MB}, 'medium.pdf'))`);
    await cdp.waitFor(`document.querySelector('.fsg-banner') ? 1 : 0`, { timeoutMs: 8000, label: 'notice banner' });
    check('S6 notice tier shows an inline banner and NO dialog', (await noOverlay()) && /60\.0 MB/.test(await cdp.eval(`window.__fg.banner()`)));
    await cdp.waitFor(`window.__fg.fileDisplay().indexOf('medium.pdf') !== -1 ? 1 : 0`, { timeoutMs: 8000, label: 'notice proceeds' });
    check('S6 notice tier stays NON-blocking (the tool proceeds)', (await cdp.eval(`window.__fg.fileDisplay()`)).includes('medium.pdf'));

    // ---------------------------------------------------------------- S7: 中文 copy
    await goto('/split-pdf/');
    await cdp.waitFor(`document.querySelector('#file-input') ? 1 : 0`, { label: 'file input' });
    await cdp.eval(`document.querySelector('[data-lang="zh"]')?.click() ?? 'no-toggle'`);
    await cdp.waitFor(`document.documentElement.lang === 'zh-CN' ? 1 : 0`, { timeoutMs: 10000, label: 'zh active' });
    await cdp.eval(`window.__fg.inject('#file-input', window.__fg.stub(${150 * MB}, '大文件.pdf'))`);
    await cdp.waitFor(`document.querySelector('.fsg-overlay') ? 1 : 0`, { timeoutMs: 8000, label: 'zh warn overlay' });
    const zhWarn = await cdp.eval(`window.__fg.overlayText()`);
    check('S7 warn copy renders in 中文', /继续|文件较大/.test(zhWarn) && /大文件\.pdf/.test(zhWarn) && /150\.0 MB/.test(zhWarn), JSON.stringify(zhWarn.replace(/\n+/g, ' / ')));
    await esc();
    await cdp.eval(`window.__fg.inject('#file-input', window.__fg.stub(${450 * MB}, '超大.pdf'))`);
    await cdp.waitFor(`document.querySelector('.fsg-overlay') ? 1 : 0`, { timeoutMs: 8000, label: 'zh block overlay' });
    const zhBlock = await cdp.eval(`window.__fg.overlayText()`);
    check('S7 block copy renders in 中文', /文件过大|拆分|压缩/.test(zhBlock), JSON.stringify(zhBlock.replace(/\n+/g, ' / ')));
    await esc();

    // ---------------------------------------------------------------- S8: homepage → editor handoff (single prompt)
    await goto('/');
    await cdp.waitFor(`document.querySelector('#hp-drop') ? 1 : 0`, { label: 'hp drop' });
    await cdp.eval(`window.__fg.drop('#hp-drop', [window.__fg.stub(${150 * MB}, 'handoff.pdf')])`);
    await cdp.waitFor(`document.querySelector('.fsg-overlay') ? 1 : 0`, { timeoutMs: 8000, label: 'handoff warn' });
    await cdp.eval(`window.__fg.clickDialogIndex(1)`);
    await cdp.waitFor(`location.pathname === '/edit-pdf/' ? 1 : 0`, { timeoutMs: 10000, label: 'landed on editor' });
    await new Promise((r) => setTimeout(r, 3500));
    check('S8 confirmed homepage handoff navigates to the editor', (await cdp.eval('location.pathname')) === '/edit-pdf/');
    check('S8 the editor does NOT ask a second time (reviewed handoff)', await noOverlay());

    // ---------------------------------------------------------------- S9: block tier refuses at the workbench entry
    await goto('/edit-pdf/');
    await cdp.waitFor(`document.querySelector('#file-input') ? 1 : 0`, { label: 'edit file input' });
    await cdp.eval(`window.__fg.inject('#file-input', window.__fg.stub(${450 * MB}, 'huge.pdf'))`);
    await cdp.waitFor(`document.querySelector('.fsg-overlay') ? 1 : 0`, { timeoutMs: 8000, label: 'edit block overlay' });
    await cdp.eval(`window.__fg.clickDialogIndex(0)`);
    await cdp.waitFor(`!document.querySelector('.fsg-overlay') ? 1 : 0`, { timeoutMs: 8000, label: 'edit block closed' });
    check('S9 a block-tier file can NOT mount the editor', await cdp.eval(`document.getElementById('embed-pdf-wrapper')?.classList.contains('hidden') !== false`));

    // ---------------------------------------------------------------- S10: nothing is READ before the guard resolves
    await goto('/split-pdf/');
    await cdp.waitFor(`document.querySelector('#file-input') ? 1 : 0`, { label: 'file input' });
    await cdp.eval(`(() => {
        window.__reads = [];
        const ab = File.prototype.arrayBuffer;
        File.prototype.arrayBuffer = function () { window.__reads.push('arrayBuffer'); return ab.apply(this, arguments); };
        const ra = FileReader.prototype.readAsArrayBuffer;
        FileReader.prototype.readAsArrayBuffer = function () { window.__reads.push('FileReader'); return ra.apply(this, arguments); };
        return 'hooked';
    })()`);
    await cdp.eval(`window.__fg.inject('#file-input', window.__fg.stub(${150 * MB}, 'big.pdf'))`);
    await cdp.waitFor(`document.querySelector('.fsg-overlay') ? 1 : 0`, { timeoutMs: 8000, label: 'warn overlay (read probe)' });
    await new Promise((r) => setTimeout(r, 600));
    check('S10 no byte is read while the warn dialog is open', (await cdp.eval('window.__reads.length')) === 0, `reads=${await cdp.eval('JSON.stringify(window.__reads)')}`);
    await esc();
    await cdp.eval(`window.__fg.inject('#file-input', window.__fg.real(${JSON.stringify(SMALL_PDF_B64)}, 'small-valid.pdf'))`);
    await cdp.waitFor(`window.__reads.length > 0 ? 1 : 0`, { timeoutMs: 8000, label: 'control read happened' });
    check('S10 (control) an allowed file IS read after the guard', (await cdp.eval('window.__reads.length')) > 0, `reads=${await cdp.eval('JSON.stringify(window.__reads)')}`);
} catch (error) {
    check('harness completed without throwing', false, error.message);
} finally {
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed`);
    await cdp.close();
    process.exit(failed ? 1 : 0);
}
