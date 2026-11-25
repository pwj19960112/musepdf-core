#!/usr/bin/env node
/**
 * Rasterise public/images/favicon.svg into the favicon set — no runtime dependency.
 *
 * The host has headless Chrome, so each size is rendered natively by Blink at a 1.0 device
 * scale factor with a transparent default background; the 16 px icon is therefore exactly what
 * a browser tab paints, not a downscale of a big render.
 *
 *   node scripts/make-favicons.mjs [--chrome <path>]
 *
 * Writes:
 *   public/favicon-16.png  public/favicon-32.png  public/favicon-48.png  public/favicon-512.png
 *   public/apple-touch-icon.png (180, opaque white)  public/favicon.ico (16/32/48)
 * The .ico and the apple-touch compositing are done by scripts/finalize-favicons.py (Pillow).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SVG = path.join(ROOT, 'public', 'images', 'favicon.svg');
const SIZES = [16, 32, 48, 512];

const CHROME_CANDIDATES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

function findChrome(explicit) {
  const list = explicit ? [explicit, ...CHROME_CANDIDATES] : CHROME_CANDIDATES;
  for (const p of list) if (fs.existsSync(p)) return p;
  throw new Error(`no Chrome found; pass --chrome <path> (tried: ${list.join(', ')})`);
}

/** Window size + the PNG's own IHDR tell us whether Blink honoured the requested size. */
function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.toString('latin1', 1, 4) !== 'PNG') throw new Error(`${file} is not a PNG`);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length };
}

function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--chrome');
  const chrome = findChrome(i >= 0 ? args[i + 1] : undefined);
  if (!fs.existsSync(SVG)) throw new Error(`missing ${SVG}`);
  console.log(`chrome: ${chrome}`);
  console.log(`source: ${SVG}`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'favicons-'));
  const svgUrl = 'file:///' + SVG.replace(/\\/g, '/');
  const rows = [];

  const render = (size, out) => {
    // A wrapper document keeps the SVG at exactly N CSS px so the screenshot is N x N;
    // loading the .svg directly would letterbox it inside the viewport.
    const html = `<!doctype html><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;overflow:hidden;background:transparent}
      img{display:block;width:${size}px;height:${size}px}
    </style><img src="${svgUrl}">`;
    const page = path.join(tmp, `m${size}.html`);
    fs.writeFileSync(page, html);
    execFileSync(chrome, [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--default-background-color=00000000', // ARGB: fully transparent
      `--window-size=${size},${size}`,
      `--screenshot=${out.replace(/\\/g, '/')}`,
      'file:///' + page.replace(/\\/g, '/'),
    ], { stdio: ['ignore', 'ignore', 'ignore'] });
    if (!fs.existsSync(out)) throw new Error(`chrome wrote nothing for ${size}px`);
    const { w, h, bytes } = pngSize(out);
    rows.push({ file: path.relative(ROOT, out).replace(/\\/g, '/'), requested: size, w, h, bytes });
    return { size, out, ok: w === size && h === size };
  };

  for (const size of SIZES) {
    const r = render(size, path.join(ROOT, 'public', `favicon-${size}.png`));
    if (!r.ok) throw new Error(`size mismatch for ${size}px`);
  }
  // 180 px master for the opaque Apple touch icon; finalised by Pillow.
  const appleSrc = path.join(tmp, 'apple-180.png');
  render(180, appleSrc);

  execFileSync('python', [path.join(ROOT, 'scripts', 'finalize-favicons.py'), appleSrc], { stdio: 'inherit' });

  console.log('\nrendered:');
  for (const r of rows) {
    console.log(`  ${r.file.padEnd(28)} ${r.w}x${r.h}px  ${r.bytes} bytes`);
  }
  console.log('  public/apple-touch-icon.png   180x180px (opaque white)');
  console.log('  public/favicon.ico            16/32/48');
  fs.rmSync(tmp, { recursive: true, force: true });
}

main();
