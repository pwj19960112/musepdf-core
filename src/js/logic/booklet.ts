import { showLoader, hideLoader, showAlert } from '../ui.js';
import { downloadFile } from '../utils/helpers.js';
import { state } from '../state.js';
import { PDFDocument, rgb, type PDFEmbeddedPage, type PDFPage } from 'pdf-lib';

/**
 * Booklet imposition — the classic saddle-stitch 2-up, so a normal printer can make an A5 booklet out of
 * A4 paper.
 *
 * The whole point is the ORDER. Printing a booklet is not "two pages per sheet": the sheets have to come
 * out of the printer in an order that stacks, folds and reads correctly. For an 8-page booklet the four
 * printed sides are
 *
 *     sheet 1 front → 8 | 1      (outside: the back cover beside the front cover)
 *     sheet 1 back  → 2 | 7
 *     sheet 2 front → 6 | 3
 *     sheet 2 back  → 4 | 5
 *
 * so that when the stack is folded down the middle every page follows the one before it. `impose()`
 * produces exactly that sequence and the panel prints it, which is what makes the result printable
 * rather than merely plausible.
 *
 * Layout notes:
 *   - Every signature is padded to a multiple of four with blank halves. A booklet cannot be imposed
 *     otherwise: the last page has to face something.
 *   - The source page is EMBEDDED (a form XObject), not rasterized, so text stays text and the file stays
 *     small.
 *   - A5 on A4 is an exact half, so a portrait A5 source is drawn at 100% — no resampling at all.
 */

export const PT_PER_MM = 72 / 25.4;

/** Sheet sizes in points, landscape (a booklet sheet is wide). */
export const SHEETS: Record<string, { width: number; height: number; label: string }> = {
    a4: { width: 841.89, height: 595.28, label: 'A4 landscape (A5 pages)' },
    letter: { width: 792, height: 612, label: 'Letter landscape (half-letter pages)' },
};

/** One printed sheet: the two pages on its front and the two on its back, left then right. */
export type BookletSheet = { front: [number, number]; back: [number, number] };

/**
 * The printed side order for a document of `pageCount` pages.
 *
 * Page numbers are 1-based; `0` means a blank half. `signature` is how many pages go into one folded
 * booklet (0 or larger than the document = one signature for the whole thing).
 */
export function impose(pageCount: number, signature = 0): BookletSheet[] {
    const total = Math.max(0, Math.trunc(pageCount));
    if (!total) return [];

    const padded = Math.ceil(total / 4) * 4;
    let sig = signature > 0 ? Math.max(4, Math.ceil(signature / 4) * 4) : padded;
    if (sig > padded) sig = padded;

    const sheets: BookletSheet[] = [];
    // `num` maps a 0-based booklet position to a 1-based page number, or 0 when the padding shows.
    const num = (index: number) => (index < total ? index + 1 : 0);

    for (let base = 0; base < padded; base += sig) {
        const size = Math.min(sig, padded - base);
        for (let k = 0; k < size / 4; k++) {
            sheets.push({
                front: [num(base + size - 1 - k * 2), num(base + k * 2)],
                back: [num(base + k * 2 + 1), num(base + size - 2 - k * 2)],
            });
        }
    }
    return sheets;
}

/** The printed sequence as text — the same string the panel shows, so the check can read it. */
export function bookletPreview(sheets: BookletSheet[]): string {
    const cell = (value: number) => (value ? String(value) : 'blank');
    return sheets
        .map((sheet, index) => `Sheet ${index + 1} front ${cell(sheet.front[0])} | ${cell(sheet.front[1])}; back ${cell(sheet.back[0])} | ${cell(sheet.back[1])}`)
        .join('. ');
}

/** How many sheets and how many blank halves a document needs. */
export function bookletStats(pageCount: number, signature = 0) {
    const sheets = impose(pageCount, signature);
    const printed = sheets.length * 2;
    const placed = sheets.reduce((sum, sheet) => sum + [...sheet.front, ...sheet.back].filter((n) => n > 0).length, 0);
    return { sheets: sheets.length, sides: printed, blanks: printed * 2 - placed };
}

type Options = {
    signature: number;
    sheet: { width: number; height: number };
    gutter: number;
    marks: 'none' | 'fold' | 'ticks';
};

function readOptions(): Options {
    const value = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';
    const signature = Number.parseInt(value('booklet-signature'), 10);
    const gutterMm = Number.parseFloat(value('booklet-gutter'));
    const marks = (value('booklet-marks') || 'none') as Options['marks'];
    return {
        signature: Number.isFinite(signature) && signature > 0 ? signature : 0,
        sheet: SHEETS[value('booklet-sheet')] ?? SHEETS.a4,
        gutter: Number.isFinite(gutterMm) ? Math.min(Math.max(gutterMm, 0), 60) * PT_PER_MM : 0,
        marks: marks === 'fold' || marks === 'ticks' ? marks : 'none',
    };
}

/** Thin marks so the fold and the trim are findable, without printing anything into the page area. */
function drawMarks(page: PDFPage, options: Options): void {
    const { width, height } = options.sheet;
    const grey = rgb(0.55, 0.55, 0.58);
    if (options.marks === 'fold') {
        page.drawLine({
            start: { x: width / 2, y: 10 },
            end: { x: width / 2, y: height - 10 },
            thickness: 0.5,
            color: grey,
            dashArray: [4, 4],
        });
        return;
    }
    if (options.marks === 'ticks') {
        const inset = 16;
        const len = 10;
        const corners = [
            { x: inset, y: inset, dx: len, dy: 0 },
            { x: inset, y: inset, dx: 0, dy: len },
            { x: width - inset, y: inset, dx: -len, dy: 0 },
            { x: width - inset, y: inset, dx: 0, dy: len },
            { x: inset, y: height - inset, dx: len, dy: 0 },
            { x: inset, y: height - inset, dx: 0, dy: -len },
            { x: width - inset, y: height - inset, dx: -len, dy: 0 },
            { x: width - inset, y: height - inset, dx: 0, dy: -len },
        ];
        for (const mark of corners) {
            page.drawLine({
                start: { x: mark.x, y: mark.y },
                end: { x: mark.x + mark.dx, y: mark.y + mark.dy },
                thickness: 0.5,
                color: grey,
            });
        }
    }
}

export function setupBooklet(): void {
    const note = document.getElementById('booklet-note');
    if (!note) return;
    const doc = state.pdfDoc as PDFDocument | null;
    if (!doc) {
        note.textContent = 'Add the PDF to see how its pages will be imposed.';
        return;
    }
    const options = readOptions();
    const pages = doc.getPageCount();
    const sheets = impose(pages, options.signature);
    const stats = bookletStats(pages, options.signature);
    note.textContent = `${pages} page(s) → ${stats.sheets} sheet(s), ${stats.sides} printed side(s), ${stats.blanks} blank half/halves. Printed order: ${bookletPreview(sheets)}`;

    // Recomputing on a settings change is what makes the sequence checkable before printing.
    for (const id of ['booklet-signature', 'booklet-sheet', 'booklet-gutter', 'booklet-marks']) {
        const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
        if (!el) continue;
        el.onchange = () => setupBooklet();
    }
}

export async function bookletPdf(): Promise<void> {
    const doc = state.pdfDoc as PDFDocument | null;
    const file = (state.files ?? [])[0] as File | undefined;
    if (!doc || !file) {
        showAlert('No file', 'Please select a PDF file first.');
        return;
    }

    const pages = doc.getPageCount();
    if (pages < 1) {
        showAlert('Empty document', 'This PDF has no pages to impose.');
        return;
    }

    const options = readOptions();
    const sheets = impose(pages, options.signature);

    showLoader('Imposing the booklet...');
    try {
        const out = await PDFDocument.create();
        const sources = doc.getPages();
        const embedded = new Map<number, PDFEmbeddedPage>();

        const embed = async (pageNumber: number) => {
            const index = pageNumber - 1;
            if (!embedded.has(index)) embedded.set(index, await out.embedPage(sources[index]));
            return embedded.get(index);
        };

        const { width: W, height: H } = options.sheet;
        const halfW = (W - options.gutter) / 2;

        const drawHalf = async (page: PDFPage, pageNumber: number, side: 0 | 1) => {
            if (!pageNumber) return;
            const source = sources[pageNumber - 1];
            if (!source) return;
            const { width: sw, height: sh } = source.getSize();
            const scale = Math.min(halfW / sw, H / sh);
            const w = sw * scale;
            const h = sh * scale;
            const originX = side === 0 ? 0 : W - halfW;
            const x = originX + (halfW - w) / 2;
            const y = (H - h) / 2;
            page.drawPage(await embed(pageNumber), { x, y, width: w, height: h });
        };

        for (const sheet of sheets) {
            for (const side of [sheet.front, sheet.back]) {
                const page = out.addPage([W, H]);
                await drawHalf(page, side[0], 0);
                await drawHalf(page, side[1], 1);
                drawMarks(page, options);
            }
        }

        out.setProducer('MusePDF');
        out.setCreator('MusePDF — booklet imposition');
        out.setTitle(`${String(file.name).replace(/\.pdf$/i, '')} (booklet)`);

        const bytes = await out.save();
        const stem = String(file.name).replace(/\.pdf$/i, '');
        downloadFile(new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }), `${stem}-booklet.pdf`);

        const stats = bookletStats(pages, options.signature);
        const result = document.getElementById('booklet-result');
        if (result) {
            result.textContent = `${stats.sheets} sheet(s), ${stats.sides} printed side(s): ${bookletPreview(sheets)}`;
        }
    } catch (error) {
        console.error('pdf-booklet:', error);
        showAlert('Booklet Error', 'Could not impose this PDF as a booklet. The file may be encrypted or use pages this reader cannot embed.');
    } finally {
        hideLoader();
    }
}
