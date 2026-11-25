import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Cdp } from './cdp-lib.mjs';

const PORT = process.argv[2] ?? '9335';
const ROUTE = process.argv[3] ?? '/extract-images/';
const FILE = process.argv[4] ?? 'a-tier/images-2page.pdf';
const BASE = 'http://localhost:4173';

const cdp = await Cdp.attachPage(PORT);
const logs = [];
cdp.onMessage((msg) => {
    if (msg.method === 'Runtime.consoleAPICalled') {
        logs.push(`console.${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
        logs.push(`EXCEPTION: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
    }
    if (msg.method === 'Log.entryAdded') logs.push(`log.${msg.params.entry.level}: ${msg.params.entry.text}`);
});
await cdp.send('Log.enable');

await cdp.goto(`${BASE}${ROUTE}`);
await cdp.waitFor('document.readyState === "complete"');
await cdp.eval(`
window.__dl = { blobs: [], names: [] };
const create = URL.createObjectURL.bind(URL);
URL.createObjectURL = (b) => { window.__dl.blobs.push(b); return create(b); };
const click = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function () { window.__dl.names.push(this.download); };
'ok'`);

const b64 = fs.readFileSync(path.join(process.cwd(), 'test-fixtures', FILE)).toString('base64');
console.log('upload:', await cdp.eval(`(() => {
  const bin = atob(${JSON.stringify(b64)}); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const input = document.querySelector('#file-input');
  if (!input) return 'no-input';
  const dt = new DataTransfer(); dt.items.add(new File([u], 'fixture.pdf', { type: 'application/pdf' }));
  input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`));

await sleep(1500);
console.log('options hidden:', await cdp.eval(`document.getElementById('${process.env.OPTIONS_ID ?? 'extract-images-options'}')?.classList.contains('hidden')`));
console.log('btn:', await cdp.eval(`(() => { const b = document.getElementById('process-btn'); return b ? { disabled: b.disabled, text: b.textContent.trim(), hasHandler: typeof b.onclick } : null; })()`));
await cdp.click('#process-btn');
await sleep(6000);
const state = await cdp.eval(`(() => ({
  blobs: window.__dl.blobs.length,
  names: window.__dl.names,
  alertOpen: !document.getElementById('alert-modal').classList.contains('hidden'),
  alertTitle: document.getElementById('alert-title').textContent,
  alertBody: document.getElementById('alert-message').textContent,
  loader: !document.getElementById('loader-modal').classList.contains('hidden'),
}))()`);
console.log('state:', JSON.stringify(state, null, 1));
console.log('--- console ---');
console.log(logs.slice(-25).join('\n'));
await cdp.close();
