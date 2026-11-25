import { showLoader, hideLoader, showAlert } from '../ui.js';
import { downloadFile } from '../utils/helpers.js';
import { state } from '../state.js';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';

/**
 * Split a PDF into parts that each come in under a target size — the "this upload form caps at 10 MB"
 * case, which is the most common reason anyone splits a PDF at all.
 *
 * WHY BINARY SEARCH
 * A page's serialized size is not proportional to its page number: one scanned page can weigh more
 * than thirty text pages. So the split point cannot be computed, it has to be MEASURED. For each part
 * the tool binary-searches the largest end page whose part, written out, still fits the target — about
 * log2(pages) serializations per part instead of a linear scan.
 *
 * The measurement is honest: it builds the part exactly the way the download is built (copyPages into a
 * fresh document, then save()), so the number the plan is based on is the number of bytes the file will
 * actually have — trailer, xref and all — not an estimate from the sum of page objects.
 *
 * A single page that is bigger than the whole target is emitted on its own and reported. No tool can
 * make an oversized page smaller without recompressing its images, and pretending otherwise would
 * produce either a lie in the UI or a corrupt file.
 */

export const MB = 1024 * 1024;

/** One output part: an inclusive 0-based page range and the bytes it serialized to. */
export type SizePart = { start: number; end: number; bytes: number };

/** `report.pdf` → `report-part-02-of-05.pdf`; a single part gets no `of` clause. */
export function partFileName(base: string, index: number, count: number): string {
    const stem = String(base || 'document').replace(/\.pdf$/i, '');
    if (count <= 1) return `${stem}-split.pdf`;
    const width = Math.max(2, String(count).length);
    return `${stem}-part-${String(index + 1).padStart(width, '0')}-of-${String(count).padStart(width, '0')}.pdf`;
}

/** A byte count a person can read at a glance. */
export function formatBytes(bytes: number): string {
    const n = Math.max(0, Number(bytes) || 0);
    if (n >= MB) return `${(n / MB).toFixed(n >= 10 * MB ? 0 : 1)} MB`;
    if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${n} B`;
}

/**
 * Plan the parts.
 *
 * `measure(start, end)` must return the serialized size of the part covering those pages (inclusive,
 * 0-based). The search is bounded so a pathological document cannot lock the tab in a loop.
 */
export async function planParts(
    totalPages: number,
    targetBytes: number,
    measure: (start: number, end: number) => Promise<number>,
    maxAttempts = 500
): Promise<SizePart[]> {
    const total = Math.max(0, Math.trunc(totalPages));
    const target = Math.max(1, Math.trunc(targetBytes));
    const parts: SizePart[] = [];
    let attempts = 0;
    let start = 0;

    while (start < total && attempts < maxAttempts) {
        let lo = start;
        let hi = total - 1;
        let best = -1;
        let bestBytes = 0;

        while (lo <= hi && attempts < maxAttempts) {
            const mid = (lo + hi) >> 1;
            attempts++;
            const size = await measure(start, mid);
            if (size <= target) {
                best = mid;
                bestBytes = size;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }

        if (best < start) {
            // Even one page is over the target. Emit it alone rather than silently looping.
            best = start;
            bestBytes = await measure(start, start);
            attempts++;
        }

        parts.push({ start, end: best, bytes: bestBytes });
        start = best + 1;
    }

    return parts;
}

function readTargetMb(): number {
    const raw = (document.getElementById('split-size-target') as HTMLInputElement | null)?.value ?? '10';
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value)) return 10;
    return Math.min(Math.max(value, 0.05), 4000);
}

/** How many pages, how big, in one line. Called on mount and again once the document is loaded. */
export function setupSplitBySize(): void {
    const note = document.getElementById('split-size-note');
    if (!note) return;
    const doc = state.pdfDoc as PDFDocument | null;
    const file = (state.files ?? [])[0] as File | undefined;
    if (!doc) {
        note.textContent = 'Add the PDF to see its page count and size.';
        return;
    }
    const pages = doc.getPageCount();
    note.textContent = file
        ? `${pages} page(s), ${formatBytes(file.size)} in total. The parts are measured as they are written, so the sizes below are the sizes of the files.`
        : `${pages} page(s). The parts are measured as they are written, so the sizes are the real file sizes.`;
}

export async function splitBySize(): Promise<void> {
    const doc = state.pdfDoc as PDFDocument | null;
    const file = (state.files ?? [])[0] as File | undefined;
    if (!doc || !file) {
        showAlert('No file', 'Please select a PDF file first.');
        return;
    }

    const total = doc.getPageCount();
    if (!total) {
        showAlert('Empty document', 'This PDF has no pages to split.');
        return;
    }

    const targetMb = readTargetMb();
    const targetBytes = Math.round(targetMb * MB);
    const result = document.getElementById('split-size-result');
    if (result) result.textContent = '';

    showLoader('Measuring the pages...');
    try {
        // Serialization is the expensive part, so a range is measured once and remembered. The plan
        // revisits the same boundaries as the search narrows, and the final write reuses the bytes.
        const cache = new Map<string, Uint8Array>();
        const build = async (start: number, end: number): Promise<Uint8Array> => {
            const key = `${start}-${end}`;
            const hit = cache.get(key);
            if (hit) return hit;
            const out = await PDFDocument.create();
            const indices: number[] = [];
            for (let i = start; i <= end; i++) indices.push(i);
            const copied = await out.copyPages(doc, indices);
            for (const page of copied) out.addPage(page);
            out.setProducer('MusePDF');
            out.setCreator('MusePDF — split by size');
            const bytes = await out.save();
            cache.set(key, bytes);
            return bytes;
        };
        const measure = async (start: number, end: number) => (await build(start, end)).length;

        const parts = await planParts(total, targetBytes, measure);
        if (!parts.length) {
            showAlert('Nothing to split', 'The document could not be split into parts.');
            return;
        }

        const stem = String(file.name).replace(/\.pdf$/i, '');
        const oversized = parts.filter((part) => part.bytes > targetBytes);

        // Every produced file is kept so the visitor can download it again with a click: an automatic
        // download can be swallowed by the browser (multiple-download blocking), which used to leave the
        // page looking dead once the alert was dismissed.
        const produced: { name: string; blob: Blob }[] = [];

        if (parts.length === 1) {
            const bytes = await build(parts[0].start, parts[0].end);
            const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
            produced.push({ name: partFileName(file.name, 0, 1), blob });
            downloadFile(blob, produced[0].name);
        } else {
            const zip = new JSZip();
            for (let i = 0; i < parts.length; i++) {
                const bytes = await build(parts[i].start, parts[i].end);
                zip.file(partFileName(file.name, i, parts.length), new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }));
            }
            const archive = await zip.generateAsync({ type: 'blob' });
            produced.push({ name: `${stem}-split-by-size.zip`, blob: archive });
            downloadFile(archive, produced[0].name);
        }

        // Explicit download UI: the alert below (or a blocked automatic download) must never be a dead end.
        if (result) {
            result.textContent = '';
            const intro = document.createElement('p');
            intro.style.margin = '0 0 8px';
            intro.textContent = `${produced.length} file(s) ready — click to download again:`;
            result.append(intro);
            for (const item of produced) {
                const url = URL.createObjectURL(item.blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = item.name;
                a.textContent = `${item.name} (${formatBytes(item.blob.size)})`;
                a.style.display = 'block';
                a.style.margin = '2px 0';
                result.append(a);
            }
        }

        const summary = parts
            .map((part, i) => `part ${i + 1}: pages ${part.start + 1}-${part.end + 1} (${formatBytes(part.bytes)})`)
            .join(', ');
        if (result) {
            // `prepend`, not `textContent`: the download links rendered above must survive.
            const summaryLine = document.createElement('p');
            summaryLine.style.margin = '0 0 8px';
            summaryLine.textContent = `${parts.length} part(s) for ${targetMb} MB — ${summary}.`;
            result.prepend(summaryLine);
        }

        if (oversized.length) {
            const worst = oversized.reduce((a, b) => (b.bytes > a.bytes ? b : a));
            showAlert(
                'One page is over the target',
                `${oversized.length} part(s) are still bigger than ${targetMb} MB because a single page does not fit: page ${worst.start + 1} alone is ${formatBytes(worst.bytes)}. Image-heavy pages cannot be shrunk by splitting — compress the PDF first if the limit is strict.`
            );
        }
    } catch (error) {
        console.error('split-pdf-by-size:', error);
        showAlert('Split Error', 'Could not split this PDF by size. The file may be encrypted or damaged.');
    } finally {
        hideLoader();
    }
}
