import { PDFDocument, PageSizes, rgb } from 'pdf-lib';
import { showLoader, hideLoader, showAlert } from '../ui.js';
import { readFileAsArrayBuffer, downloadFile } from '../utils/helpers.js';
import { state } from '../state.js';

/**
 * Booklet imposition (saddle-stitch): pages are re-ordered so that printing double-sided, flipping on the
 * SHORT edge, folding the stack in half and stapling the spine produces a readable booklet.
 *
 * The page maths is separated from the PDF work (`bookletPlan`) because getting it wrong is silent — the
 * output looks like a PDF, it is just unreadable once folded — so the UI shows the plan as a table of
 * "sheet 1 front: page 8 | page 1" before anything is written, and the plan is unit-testable on its own.
 *
 * Padding: a signature must hold a multiple of 4 pages; missing slots become blank pages at the END of the
 * signature (never in the middle, which would shift every chapter after the gap).
 */

export type Sheet = { front: [number, number]; back: [number, number] };
export type Plan = { sheets: Sheet[]; padded: number; signatures: number; perSignature: number };

const ARABIC = (n: number) => String(n + 1);

/** pagesPerSignature: 4/8/16, or 0 meaning "one signature for the whole document". */
export function bookletPlan(pageCount: number, pagesPerSignature: number): Plan {
    const per = pagesPerSignature > 0 ? Math.max(4, pagesPerSignature - (pagesPerSignature % 4)) : Math.max(4, Math.ceil(pageCount / 4) * 4);
    const signatures = Math.max(1, Math.ceil(pageCount / per));
    const sheets: Sheet[] = [];
    let padded = 0;

    for (let s = 0; s < signatures; s++) {
        const first = s * per;
        const last = Math.min(first + per, pageCount); // exclusive
        const real = last - first;
        const total = Math.ceil(real / 4) * 4; // slots in this signature
        padded += total - real;
        // Slot i (0-based) maps to a real page index, or -1 for a blank at the end of the signature.
        const slot = (i: number) => (i < real ? first + i : -1);
        for (let k = 0; k < total / 4; k++) {
            sheets.push({
                front: [slot(total - 1 - 2 * k), slot(2 * k)],
                back: [slot(2 + 2 * k), slot(total - 2 - 2 * k)],
            });
        }
    }
    return { sheets, padded, signatures, perSignature: per };
}

export function describePlan(plan: Plan): string[] {
    return plan.sheets.map((sheet, i) => {
        const label = (idx: number) => (idx < 0 ? 'blank' : `p${ARABIC(idx)}`);
        return `Sheet ${i + 1} — front: ${label(sheet.front[0])} | ${label(sheet.front[1])}, back: ${label(sheet.back[0])} | ${label(sheet.back[1])}`;
    });
}

const PAPER: Record<string, [number, number]> = {
    a4: [842, 595], // A4 landscape (points)
    letter: [792, 612], // Letter landscape
    a3: [1191, 842],
};

export function setupBooklet(): void {
    const preview = document.getElementById('booklet-preview');
    const note = document.getElementById('booklet-note');
    if (!preview || !note) return;
    const file = (state.files ?? [])[0];
    if (!file) {
        preview.textContent = '';
        return;
    }
    void (async () => {
        try {
            const bytes = await readFileAsArrayBuffer(file);
            const doc = await PDFDocument.load(bytes as ArrayBuffer, { ignoreEncryption: true });
            const per = Number.parseInt((document.getElementById('booklet-signature') as HTMLSelectElement | null)?.value ?? '16', 10) || 16;
            const plan = bookletPlan(doc.getPageCount(), per);
            preview.textContent = '';
            const head = document.createElement('p');
            head.style.margin = '0 0 6px';
            head.textContent = `${plan.sheets.length} sheet(s), ${plan.signatures} signature(s) of up to ${plan.perSignature} pages${plan.padded ? `, ${plan.padded} blank page(s) added` : ''}. Print double-sided, flip on the SHORT edge.`;
            const list = document.createElement('ul');
            list.style.margin = '0';
            list.style.paddingLeft = '18px';
            describePlan(plan).forEach((line) => {
                const li = document.createElement('li');
                li.textContent = line;
                list.append(li);
            });
            preview.append(head, list);
        } catch {
            preview.textContent = 'Could not read the page count of this file.';
        }
    })();
}

export async function bookletPdf(): Promise<void> {
    const file = (state.files ?? [])[0];
    const result = document.getElementById('booklet-result');
    if (!file) {
        showAlert('No file', 'Please select a PDF file first.');
        return;
    }

    showLoader('Imposing booklet pages...');
    try {
        const bytes = await readFileAsArrayBuffer(file);
        const src = await PDFDocument.load(bytes as ArrayBuffer, { ignoreEncryption: true });
        const srcCount = src.getPageCount();

        const per = Number.parseInt((document.getElementById('booklet-signature') as HTMLSelectElement | null)?.value ?? '16', 10) || 16;
        const paperKey = (document.getElementById('booklet-paper') as HTMLSelectElement | null)?.value ?? 'a4';
        const scaleMode = (document.getElementById('booklet-scale') as HTMLSelectElement | null)?.value ?? 'fit';
        const creepMm = Math.max(0, Math.min(20, Number.parseFloat((document.getElementById('booklet-creep') as HTMLInputElement | null)?.value ?? '0') || 0));

        const plan = bookletPlan(srcCount, per);
        const [paperW, paperH] = PAPER[paperKey] ?? PAPER.a4;
        const halfW = paperW / 2;
        const creep = (creepMm / 25.4) * 72;

        const srcPages = src.getPages();
        const out = await PDFDocument.create();

        // One output sheet per side, with the two source pages embedded and drawn into the halves. `embedPage`
        // + `drawPage` is pdf-lib's supported way to compose pages from another document (copying a page and
        // moving its MediaBox leaves the content at its original size and clips it instead).
        for (const sheet of plan.sheets) {
            for (const side of [sheet.front, sheet.back] as [number, number][]) {
                const target = out.addPage([paperW, paperH]);
                for (let slotIndex = 0; slotIndex < 2; slotIndex++) {
                    const pageIndex = side[slotIndex];
                    if (pageIndex < 0) continue;
                    const source = srcPages[pageIndex];
                    const { width: w, height: h } = source.getSize();
                    const scale = scaleMode === 'fit' ? Math.min(halfW / w, paperH / h) : 1;
                    const drawW = w * scale;
                    const drawH = h * scale;
                    const creepShift = slotIndex === 0 ? creep : -creep;
                    const x = slotIndex * halfW + (halfW - drawW) / 2 + creepShift;
                    const y = (paperH - drawH) / 2;
                    const embedded = await out.embedPage(source);
                    target.drawPage(embedded, { x, y, width: drawW, height: drawH });
                }
            }
        }

        const saved = await out.save();
        const blob = new Blob([saved as unknown as BlobPart], { type: 'application/pdf' });
        const name = `${String(file.name).replace(/\.pdf$/i, '')}-booklet.pdf`;
        downloadFile(blob, name);

        if (result) {
            result.textContent = '';
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = name;
            a.textContent = `${name} (${(blob.size / 1024).toFixed(0)} KB) — click to download again`;
            result.append(a);
        }
    } catch (error) {
        console.error('pdf-booklet:', error);
        showAlert('Booklet error', 'Could not build the booklet. The file may be encrypted or damaged.');
    } finally {
        hideLoader();
    }
}
