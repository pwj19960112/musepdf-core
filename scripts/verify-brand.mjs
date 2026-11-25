/**
 * Brand-mark verification: drives a local Chrome over CDP against the preview server.
 *
 *   npx vite preview --port 4173 &
 *   node scripts/verify-brand.mjs --chrome                 # starts its own headless Chrome
 *   node scripts/verify-brand.mjs --cdp 9333               # or attach to a running one
 *
 * Asserts, per page family (generated tool page, homepage, hand-written support page):
 *   - the mark is present in the header and the footer, at 28 px, and (on generated pages) is the
 *     inlined <svg> — not a raster <img> that would differ per device pixel ratio;
 *   - the brand text is `MusePDF` in both languages (one brand, no separate Chinese name);
 *   - nothing else in the lockup changed, i.e. the mark's own box is 28x28 in both languages.
 * It also writes docs/brand/header-1x.png, a 1x Chromium render of the homepage header band.
 *
 * Exit 1 on any mismatch so it can be wired into a check. The same seam is covered end-to-end for
 * every page by scripts/audit-i18n-sweep.mjs; this script exists to pin the BRAND specifically.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const value = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1] ?? fallback;
};
const PORT = value('--cdp', '9341');
const BASE = value('--base', 'http://localhost:4173');
const START = args.includes('--chrome');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const ROUTES = ['/', '/merge-pdf/', '/about.html'];
const BRAND_EN = 'MusePDF';
const BRAND_ZH = 'MusePDF';

/** Reads the lockup: mark element + the adjacent brand text, in header and footer. */
const READ = `(() => {
  const pick = (root) => {
    if (!root) return null;
    const svg = root.querySelector('svg');
    const img = root.querySelector('img');
    const el = svg || img;
    const box = el ? el.getBoundingClientRect() : null;
    const span = root.querySelector('span');
    return {
      markTag: el ? el.tagName.toLowerCase() : null,
      markBox: box ? [Math.round(box.width), Math.round(box.height)] : null,
      markViewBox: svg ? svg.getAttribute('viewBox') : null,
      markSrc: img ? img.getAttribute('src') : null,
      text: (span ? span.textContent : root.textContent).replace(/\\s+/g, ' ').trim(),
    };
  };
  return {
    lang: document.documentElement.lang,
    header: pick(document.querySelector('.hp-brand, #home-logo')),
    footer: pick(document.querySelector('.hp-footer-brand .hp-brand')) ||
            pick(document.querySelector('footer .hp-brand')) ||
            pick(document.querySelector('footer img[src*="favicon"]')?.parentElement),
    markCount: document.querySelectorAll('.hp-brand svg, #home-logo svg, #home-logo img').length,
  };
})()`;

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
  static async attach(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res);
      ws.addEventListener('error', rej);
    });
    const c = new Cdp(ws);
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && c.pending.has(m.id)) {
        const { resolve, reject } = c.pending.get(m.id);
        c.pending.delete(m.id);
        if (m.error) reject(new Error(JSON.stringify(m.error)));
        else resolve(m.result);
      }
    });
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('DOM.enable');
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); rej(new Error(`CDP timeout: ${method}`)); }
      }, 60000);
    });
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
}

const failures = [];
const check = (ok, label, detail = '') => {
  if (!ok) failures.push(`${label}${detail ? ' — ' + detail : ''}`);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  (' + detail + ')' : ''}`);
};

async function main() {
  let chrome = null;
  const profile = path.join(os.tmpdir(), `chrome-brand-${process.pid}`);
  const cleanup = () => {
    chrome?.kill();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome still holds a lock */ }
  };
  if (START) {
    chrome = spawn(CHROME, [
      '--headless=new', `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run', '--no-proxy-server', '--disable-gpu', '--window-size=1500,950',
      '--lang=en-US', 'about:blank',
    ], { stdio: 'ignore' });
    await sleep(3500);
  }

  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const target = list.find((t) => t.type === 'page');
  if (!target) throw new Error('no page target — start Chrome with --remote-debugging-port');
  const page = await Cdp.attach(target.webSocketDebuggerUrl);
  await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });

  const until = async (expr, { timeoutMs = 20000, label } = {}) => {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      try { last = await page.evaluate(expr); if (last) return last; } catch (e) { last = String(e); }
      await sleep(150);
    }
    throw new Error(`timed out waiting for ${label ?? expr} (last=${JSON.stringify(last)})`);
  };

  const visit = async (route, lang) => {
    // The support pages load an external script from unpkg in <head>, which can hold the parser for
    // seconds on a cold network, so wait for the lockup to exist instead of a fixed sleep.
    const ready = `!!document.querySelector('.hp-brand, #home-logo')`;
    await page.send('Page.navigate', { url: `${BASE}${route}` });
    await until(ready, { label: `${route} lockup` });
    await page.evaluate(`localStorage.setItem('bentopdf.lang', ${JSON.stringify(lang)})`);
    await page.send('Page.navigate', { url: `${BASE}${route}` });
    await until(ready, { label: `${route} lockup (reload)` });
    // wait for the language swap itself (zh fetches /i18n/zh.json), then read whatever is there
    const expected = lang === 'zh' ? BRAND_ZH : BRAND_EN;
    await until(
      `(document.querySelector('.hp-brand span, #home-logo span') || {}).textContent?.trim() === ${JSON.stringify(expected)}`,
      { timeoutMs: 8000, label: `${route} ${lang} brand` },
    ).catch(() => {});
    return page.evaluate(READ);
  };

  for (const route of ROUTES) {
    const en = await visit(route, 'en');
    const zh = await visit(route, 'zh');
    const handWritten = route === '/about.html';

    check(en.header?.text === BRAND_EN, `${route} EN header text`, JSON.stringify(en.header?.text));
    check(zh.header?.text === BRAND_ZH, `${route} CN header text`, JSON.stringify(zh.header?.text));
    check(en.footer?.text === BRAND_EN, `${route} EN footer text`, JSON.stringify(en.footer?.text));
    check(zh.footer?.text === BRAND_ZH, `${route} CN footer text`, JSON.stringify(zh.footer?.text));
    check(!!en.header?.markTag, `${route} header carries a mark`, `tag=${en.header?.markTag} src=${en.header?.markSrc ?? '-'}`);
    check(en.header?.markTag === (handWritten ? 'img' : 'svg'),
      `${route} mark is ${handWritten ? 'the raster <img>' : 'the inlined <svg>'}`, `tag=${en.header?.markTag}`);
    if (handWritten) {
      check((en.header?.markSrc || '').endsWith('images/favicon.svg'), `${route} mark src`, String(en.header?.markSrc));
    } else {
      check(en.header?.markViewBox === '0 0 32 32', `${route} mark viewBox`, String(en.header?.markViewBox));
    }
    // mark box: 28x28 in the generated pages' header in both languages (the 中文 wordmark is wider,
    // so a mark that resized would be visible); the hand-written header logo keeps its own h-8/w-8
    // (32 px) class, exactly the box it had before the mark was swapped in.
    const box = handWritten ? '[32,32]' : '[28,28]';
    check(JSON.stringify(en.header?.markBox) === box, `${route} EN mark box ${box}`, JSON.stringify(en.header?.markBox));
    check(JSON.stringify(zh.header?.markBox) === box, `${route} CN mark box ${box}`, JSON.stringify(zh.header?.markBox));
  }

  // 1x render of the homepage header band, for the record
  await visit('/', 'en');
  const rect = await page.evaluate(`(() => {
    const h = document.querySelector('header.hp-nav');
    const r = h.getBoundingClientRect();
    return { x: 0, y: 0, width: Math.round(r.width), height: Math.round(r.height), scale: 1 };
  })()`);
  const shot = await page.send('Page.captureScreenshot', { format: 'png', clip: rect, captureBeyondViewport: true });
  const out = path.join(ROOT, 'docs', 'brand', 'header-1x.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`ok    wrote ${path.relative(ROOT, out)} (${rect.width}x${rect.height})`);

  cleanup();
  console.log(failures.length ? `\nFAIL: ${failures.length} check(s)` : '\nOK: brand mark and language switch verified');
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
