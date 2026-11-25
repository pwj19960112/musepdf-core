/**
 * Re-parses a workbench markup export with pdf.js — the "it is in the file" half of the proof.
 *
 *   node scripts/verify-markup-export.mjs test-fixtures/markup/annotate-export.pdf
 *   node scripts/verify-markup-export.mjs --all            # every file the driver wrote
 *
 * Prints, per page: the annotation objects PDFium wrote (/Subtype, /Contents, /Rect, /C, appearance
 * stream present) and the extractable text layer. Then checks the expectations for the flows:
 *
 *   annotate-export.pdf  a /Highlight and a /FreeText whose /Contents is the Chinese note
 *   stamp-export.pdf     a /Stamp whose /Contents and /Subj are the Chinese stamp label
 *   sign-export.pdf      a /Stamp carrying the signature image + the signed-with note
 *   redact-export.pdf    the redacted line's text is GONE from the extractable text layer
 *
 * Exit 1 when an expectation does not hold.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'test-fixtures', 'markup');
const ZH_NOTE = '请复核此处标注';
const ZH_STAMP = '已批准';
const REDACTED_TEXT = 'The quick brown fox';

const args = process.argv.slice(2);
const files = args.includes('--all')
    ? ['annotate-export.pdf', 'stamp-export.pdf', 'sign-export.pdf', 'redact-export.pdf'].map((f) =>
          path.join(OUT, f),
      )
    : args.filter((a) => !a.startsWith('--'));

const failures = [];
const check = (label, ok, detail) => {
    if (!ok) failures.push(label);
    console.log(
        `${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`,
    );
};

async function inspect(file) {
    // pdf.js TRANSFERS the `data` buffer to its worker pool, which DETACHES the Uint8Array it was
    // handed (byteLength becomes 0). Any structural byte scan must therefore run BEFORE getDocument,
    // or it silently sees all zeros and reports "no markers" for a file that is full of them.
    const bytes = new Uint8Array(fs.readFileSync(file));
    const raw = Buffer.from(bytes).toString('latin1');
    const pdf = await getDocument({ data: bytes }).promise;
    const page = await pdf.getPage(1);
    const annotations = await page.getAnnotations();
    const text = (await page.getTextContent()).items.map((i) => i.str).join('');
    const rawCounts = {
        SubtypeHighlight: (raw.match(/\/Subtype\s*\/Highlight/g) ?? []).length,
        SubtypeFreeText: (raw.match(/\/Subtype\s*\/FreeText/g) ?? []).length,
        SubtypeStamp: (raw.match(/\/Subtype\s*\/Stamp/g) ?? []).length,
        SubtypeRedact: (raw.match(/\/Subtype\s*\/Redact/g) ?? []).length,
        AP: (raw.match(/\/AP\b/g) ?? []).length,
        QuadPoints: (raw.match(/\/QuadPoints/g) ?? []).length,
        ImageXObject: (raw.match(/\/Subtype\s*\/Image/g) ?? []).length,
    };
    await pdf.cleanup();
    // pdf.js ≥4 exposes annotation text as `contentsObj.str`; the deprecated `contents` alias is
    // empty. Map once here so BOTH the log and the assertions read the real string.
    const mappedAnnotations = annotations.map((a) => ({
        subtype: a.subtype,
        contents: a.contentsObj?.str ?? a.contents ?? "",
        subject: a.subject,
        rect: a.rect,
        color: a.color,
        hasAppearance: a.hasAppearance ?? !!a.hasOwnCanvas,
        hasImage: !!a.image,
        fieldName: a.fieldName,
    }));
    return { bytes: bytes.length, text, annotations: mappedAnnotations, rawCounts };
}

for (const file of files) {
    const name = path.basename(file);
    console.log(`\n================ ${name} (${fs.statSync(file).size} bytes)`);
    const { text, annotations, rawCounts } = await inspect(file);
    console.log('extractable text:', JSON.stringify(text.slice(0, 200)));
    console.log('raw byte markers:', JSON.stringify(rawCounts));
    console.log('annotations:', JSON.stringify(annotations, null, 1));

    if (name === 'annotate-export.pdf') {
        const highlight = annotations.find((a) => a.subtype === 'Highlight');
        const freeText = annotations.find((a) => a.subtype === 'FreeText');
        check('annotate: a /Highlight annotation is in the file', !!highlight, rawCounts);
        check('annotate: a /FreeText annotation is in the file', !!freeText);
        check(
            `annotate: the text note carries the Chinese /Contents (${ZH_NOTE})`,
            freeText?.contents === ZH_NOTE,
            freeText?.contents,
        );
        check(
            'annotate: the highlight carries an appearance stream',
            rawCounts.AP > 0 && highlight?.hasAppearance !== false,
            { AP: rawCounts.AP, hasAppearance: highlight?.hasAppearance },
        );
    }
    if (name === 'stamp-export.pdf') {
        const stamp = annotations.find((a) => a.subtype === 'Stamp');
        check('stamp: a /Stamp annotation is in the file', !!stamp);
        check(
            `stamp: the stamp carries the Chinese label (${ZH_STAMP})`,
            stamp?.contents === ZH_STAMP || stamp?.subject === ZH_STAMP,
            { contents: stamp?.contents, subject: stamp?.subject },
        );
        check('stamp: the stamp has an image object in the appearance', rawCounts.ImageXObject > 0, rawCounts);
    }
    if (name === 'sign-export.pdf') {
        const stamp = annotations.find((a) => a.subtype === 'Stamp');
        check('sign: the signature lands as a /Stamp annotation', !!stamp);
        check(
            'sign: the signature annotation records what it is',
            /BentoPDF/.test(stamp?.contents ?? '') || stamp?.subject === 'signature',
            { contents: stamp?.contents, subject: stamp?.subject },
        );
        check('sign: the signature has an image object in the appearance', rawCounts.ImageXObject > 0, rawCounts);
    }
    if (name === 'redact-export.pdf') {
        check(
            'redact: the covered text is GONE from the extractable text layer',
            !text.includes(REDACTED_TEXT),
            text.slice(0, 120),
        );
        check(
            'redact: no /Redact annotation is left behind (PDFium consumes it on apply)',
            rawCounts.SubtypeRedact === 0,
            rawCounts,
        );
    }
}

if (failures.length) {
    console.error(`\nFAILED: ${failures.join(' | ')}`);
    process.exit(1);
}
console.log('\nall file-level checks passed');
