import fs from 'node:fs';
import zlib from 'node:zlib';
const b = fs.readFileSync(process.argv[2]);
const s = b.toString('latin1');
const re = /(\d+)\s+0\s+obj([\s\S]*?)stream\r?\n/g;
let m;
while ((m = re.exec(s))) {
  const objNum = m[1];
  const dict = m[2].replace(/\s+/g, ' ');
  if (/\/Subtype\s*\/Image/.test(dict)) continue;
  const start = m.index + m[0].length;
  const lenMatch = /\/Length (\d+)/.exec(dict);
  const len = lenMatch ? Number(lenMatch[1]) : null;
  if (!len) continue;
  const raw = b.subarray(start, start + len);
  let txt;
  try {
    txt = zlib.inflateSync(raw).toString('latin1');
  } catch (e) {
    txt = `<inflate failed: ${e.message}>`;
  }
  if (/\/Form|\/Image/.test(dict)) {
    console.log(`\n=== obj ${objNum}: ${dict.slice(0, 260)}`);
    console.log(`content: ${JSON.stringify(txt)}`);
  }
}
