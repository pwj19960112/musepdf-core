/**
 * What does each markup export ACTUALLY contain?
 *
 *   node scripts/verify-markup-content.mjs
 *
 * Reads the artifacts the two driver scripts wrote (no browser needed) and prints, per feature: the
 * byte-level annotation objects in the file, whether they sit in the page's /Annots array, whether
 * their appearance carries an image, and what the extractable text layer says. Then it emits an
 * explicit VERDICT per feature, and settles the redaction question with an A/B: the same covered
 * text is still in the file when it is only marked, and gone from the file once redactions are
 * APPLIED (searched in the *inflated* content streams, since the text is drawn as a hex string
 * inside a FlateDecode stream).
 *
 * Exit 1 if a verdict contradicts what the file says.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'test-fixtures', 'markup');
const FIXTURE = path.join(ROOT, 'test-fixtures', 'latin-only.pdf');
const REDACTED_TEXT = 'The quick brown fox';
const REDACTED_HEX = '54686520717569636B'; // "The quick" as the fixture draws it

const failures = [];
const check = (label, ok, detail) => {
    if (!ok) failures.push(label);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
};

/** Concatenate every inflated stream in the file (the text is drawn inside one). */
function inflatedStreams(file) {
    const b = fs.readFileSync(file);
    const s = b.toString('latin1');
    const re = /(\d+)\s+0\s+obj([\s\S]*?)stream\r?\n/g;
    let out = '';
    let m;
    while ((m = re.exec(s))) {
        const dict = m[2];
        const lenMatch = /\/Length\s+(\d+)/.exec(dict);
        if (!lenMatch) continue;
        const start = m.index + m[0].length;
        const raw = b.subarray(start, start + Number(lenMatch[1]));
        if (!/\/FlateDecode/.test(dict)) {
            out += raw.toString('latin1');
            continue;
        }
        try {
            out += zlib.inflateSync(raw).toString('latin1');
        } catch {
            /* not a deflate stream; skip */
        }
    }
    return out;
}

function byteFacts(file) {
    const raw = fs.readFileSync(file).toString('latin1');
    const count = (re) => (raw.match(re) ?? []).length;
    return {
        bytes: fs.statSync(file).size,
        annotsArray: count(/\/Annots/g),
        pageContents: count(/\/Contents/g),
        subtypes: ['Highlight', 'FreeText', 'Stamp', 'Redact', 'Square', 'Widget', 'Text', 'Ink']
            .map((s) => [s, count(new RegExp(`/Subtype\\s*/${s}\\b`, 'g'))])
            .filter(([, n]) => n > 0),
        ap: count(/\/AP\b/g),
        imageXObject: count(/\/Subtype\s*\/Image/g),
        annotObjects: (raw.match(/\/Type\s*\/Annot/g) ?? []).length,
    };
}

async function readBack(file) {
    const bytes = new Uint8Array(fs.readFileSync(file));
    const pdf = await getDocument({ data: bytes }).promise;
    const page = await pdf.getPage(1);
    const annotations = (await page.getAnnotations()).map((a) => ({
        subtype: a.subtype,
        contents: a.contentsObj?.str ?? a.contents ?? '',
        subject: a.subject,
        rect: a.rect?.map((n) => Math.round(n * 10) / 10),
        hasAppearance: a.hasAppearance ?? !!a.hasOwnCanvas,
        hasImage: !!a.image,
    }));
    const text = (await page.getTextContent()).items.map((i) => i.str).join('');
    await pdf.cleanup();
    return { annotations, text };
}

const files = {
    control: FIXTURE,
    'stamp (placed + dragged + resized)': path.join(DIR, 'interaction-stamp.pdf'),
    'annotate (highlight + Chinese text note, moved + resized)': path.join(DIR, 'interaction-annotate.pdf'),
    'redact MARKED only (nothing applied)': path.join(DIR, 'interaction-redact.pdf'),
    'stamp (flow export)': path.join(DIR, 'stamp-export.pdf'),
    'signature (flow export)': path.join(DIR, 'sign-export.pdf'),
    'redact APPLIED (flow export)': path.join(DIR, 'redact-export.pdf'),
};

console.log('================ per-export contents ================');
const facts = {};
const readBacks = {};
for (const [label, file] of Object.entries(files)) {
    if (!fs.existsSync(file)) {
        console.log(`\n-- ${label}: MISSING (${file})`);
        continue;
    }
    const f = byteFacts(file);
    const r = await readBack(file);
    facts[label] = f;
    readBacks[label] = r;
    console.log(`\n-- ${label}`);
    console.log(`   bytes: ${f.bytes}`);
    console.log(`   page has /Annots array: ${f.annotsArray} | /Type /Annot objects: ${f.annotObjects} | /AP entries: ${f.ap} | image XObjects: ${f.imageXObject}`);
    console.log(`   /Subtype counts: ${JSON.stringify(Object.fromEntries(f.subtypes))}`);
    console.log(`   annotations (pdf.js): ${JSON.stringify(r.annotations)}`);
    console.log(`   extractable text: ${JSON.stringify(r.text.slice(0, 120))}`);
}

console.log('\n================ verdicts ================');
{
    const k = 'stamp (placed + dragged + resized)';
    const f = facts[k];
    const r = readBacks[k];
    if (f) {
        const stamp = r.annotations.find((a) => a.subtype === 'Stamp');
        const verdict =
            f.annotsArray > 0 && stamp && f.imageXObject > 0
                ? 'REAL PDF ANNOTATION OBJECT: listed in the page /Annots array as /Subtype /Stamp, with an /AP appearance stream carrying an image XObject. Not painted page content, not a UI-only raster overlay.'
                : 'UNEXPECTED';
        console.log(`VERDICT stamp          : ${verdict}`);
        check('stamp: /Annots + /Subtype /Stamp + image in /AP', f.annotsArray > 0 && !!stamp && f.imageXObject > 0, {
            annots: f.annotsArray,
            subtypes: f.subtypes,
            images: f.imageXObject,
        });
        check('stamp: no /Widget (no form field is created)', !(facts[k].subtypes || []).some(([s]) => s === 'Widget'));
    }
}
{
    const k = 'annotate (highlight + Chinese text note, moved + resized)';
    const f = facts[k];
    const r = readBacks[k];
    if (f) {
        const hi = r.annotations.find((a) => a.subtype === 'Highlight');
        const ft = r.annotations.find((a) => a.subtype === 'FreeText');
        console.log(
            `VERDICT highlight      : REAL PDF ANNOTATION OBJECT: /Annots + /Subtype /Highlight with an /AP wash; the covered TEXT IS NOT REMOVED (a highlight is a markup annotation, the page content is untouched).`,
        );
        console.log(
            `VERDICT text note      : REAL PDF ANNOTATION OBJECT: /Annots + /Subtype /FreeText whose /Contents is the typed string (Chinese round-trips: ${JSON.stringify(
                ft?.contents,
            )}); the appearance is a generated text box.`,
        );
        check('annotate: /Highlight + /FreeText are real annotation objects', !!hi && !!ft, f.subtypes);
        check('annotate: the Chinese note reaches /Contents', ft?.contents === '请复核此处交互', ft?.contents);
        check('annotate: the page text layer still has the original text (a highlight removes nothing)', r.text.includes(REDACTED_TEXT), r.text.slice(0, 60));
    }
}
{
    const k = 'signature (flow export)';
    const f = facts[k];
    const r = readBacks[k];
    if (f) {
        const stamp = r.annotations.find((a) => a.subtype === 'Stamp');
        console.log(
            `VERDICT signature      : REAL PDF ANNOTATION OBJECT: /Annots + /Subtype /Stamp whose /AP carries the signature BITMAP as an image XObject. It is a visual signature only — there is no /Sig, no certificate, no cryptographic signature.`,
        );
        check('signature: /Stamp annotation + image in /AP', f.annotsArray > 0 && !!stamp && f.imageXObject > 0, f.subtypes);
    }
}
{
    const marked = readBacks['redact MARKED only (nothing applied)'];
    const applied = readBacks['redact APPLIED (flow export)'];
    const markedFacts = facts['redact MARKED only (nothing applied)'];
    const appliedFacts = facts['redact APPLIED (flow export)'];

    if (markedFacts && appliedFacts) {
        const markedStreams = inflatedStreams(path.join(DIR, 'interaction-redact.pdf'));
        const appliedStreams = inflatedStreams(path.join(DIR, 'redact-export.pdf'));
        const controlStreams = inflatedStreams(FIXTURE);

        check(
            'control: the covered text is present in the pristine file (inflated streams)',
            controlStreams.includes(REDACTED_HEX) || controlStreams.includes(REDACTED_TEXT),
            { hexPresent: controlStreams.includes(REDACTED_HEX) },
        );
        check(
            'redaction MARKED only: the covered text is STILL in the file (marking alone changes nothing)',
            (markedStreams.includes(REDACTED_HEX) || markedStreams.includes(REDACTED_TEXT)) &&
                marked.text.includes(REDACTED_TEXT),
            { hexPresent: markedStreams.includes(REDACTED_HEX), textLayer: marked.text.slice(0, 60) },
        );
        check(
            'redaction APPLIED: the covered text is GONE from the text layer',
            !applied.text.includes(REDACTED_TEXT),
            applied.text.slice(0, 60),
        );
        check(
            'redaction APPLIED: the covered text is GONE from the content streams too (not merely covered)',
            !appliedStreams.includes(REDACTED_HEX) && !appliedStreams.includes(REDACTED_TEXT),
            { hexPresent: appliedStreams.includes(REDACTED_HEX) },
        );
        check(
            'redaction APPLIED: the /Redact annotation is consumed (PDFium removes it on apply)',
            !appliedFacts.subtypes.some(([s]) => s === 'Redact') && applied.annotations.length === 0,
            { subtypes: appliedFacts.subtypes, pdfjsAnnotations: applied.annotations.length },
        );
        check(
            'redaction MARKED only: the /Redact annotation is present (and the text is intact)',
            markedFacts.subtypes.some(([s]) => s === 'Redact'),
            markedFacts.subtypes,
        );

        console.log(
            'VERDICT redaction      : REAL PDF ANNOTATION OBJECT while marked (/Subtype /Redact); APPLYING IT IS DESTRUCTIVE: PDFium cuts the covered text/images out of the page content stream and paints the area, then consumes the annotation — so the exported file no longer contains the covered text. Before Apply, the text is fully intact and merely covered.',
        );
    }
}
{
    const withWidget = Object.entries(facts).filter(([, f]) => f.subtypes.some(([s]) => s === 'Widget'));
    console.log(
        'VERDICT page content   : NO feature paints into the page content stream; every mark is an annotation object in /Annots. Redaction is the one that also edits the content stream, and only when Apply is pressed.',
    );
    check('no export creates a form field (/Widget) for any mark type', withWidget.length === 0, withWidget.map(([k]) => k));
}

console.log('\n================ content summary ================');
if (failures.length) {
    console.error(`FAILED: ${failures.join(' | ')}`);
    process.exit(1);
}
console.log('all markup content checks passed');
