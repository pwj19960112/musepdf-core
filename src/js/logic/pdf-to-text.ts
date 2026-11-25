import { showLoader, hideLoader, showAlert } from '../ui.js';
import { downloadFile, readFileAsArrayBuffer } from '../utils/helpers.js';
import { state } from '../state.js';

/**
 * PDF to text.
 *
 * Reads the text layer of a PDF with pdf.js — page by page, in the browser — and hands back a plain
 * `.txt` file. Nothing is uploaded: the file is opened with `readFileAsArrayBuffer`, parsed by the
 * pdf.js worker that ships with the site, and the result is written straight to a download.
 *
 * What it will NOT do is make up text. A scanned PDF has no text layer at all, and a page that is one
 * big image has none either; both are reported instead of exporting a blank file, with a pointer to
 * the OCR tool (which builds a text layer first). The per-page accounting below is what makes that
 * answer honest rather than a guess.
 */

/** One pdf.js text item — only the fields this tool reads (`str`, line breaks, the text baseline). */
export type TextItem = {
    str?: string;
    hasEOL?: boolean;
    transform?: number[];
    width?: number;
};

/**
 * Turn one page's text items into lines.
 *
 * `hasEOL` is pdf.js's own line-break hint and is usually enough, but plenty of producers never set
 * it — so a change in the text baseline (`transform[5]`, the Y coordinate) also starts a new line.
 * Without that second rule a two-column report comes out as one 4,000-character run.
 */
export function pageTextFromItems(items: TextItem[]): string {
    const lines: string[] = [];
    let line = '';
    let lastY: number | null = null;
    let lineEndX: number | null = null;

    for (const item of items) {
        if (typeof item.str !== 'string') continue;
        const transform = Array.isArray(item.transform) ? item.transform : null;
        const x = transform ? transform[4] : undefined;
        const y = transform ? transform[5] : undefined;

        // A new baseline is a new line — pdf.js only sets `hasEOL` when the producer bothered to mark it.
        if (lastY !== null && typeof y === 'number' && Math.abs(y - lastY) > 1 && line.trim()) {
            lines.push(line);
            line = '';
            lineEndX = null;
        }

        // Two runs on the same line but with a visible gap: the space is usually a positioning gap, not
        // a space character, so without this "Total:" + "1,024" comes out as "Total:1,024".
        if (typeof x === 'number' && lineEndX !== null && x > lineEndX + 0.5 && line && !line.endsWith(' ') && !/^\s/.test(item.str)) {
            line += ' ';
        }

        line += item.str;
        if (typeof y === 'number') lastY = y;
        if (typeof x === 'number') lineEndX = x + (typeof item.width === 'number' ? item.width : 0);

        if (item.hasEOL) {
            lines.push(line);
            line = '';
            lineEndX = null;
        }
    }
    if (line.trim()) lines.push(line);

    return lines.map((l) => l.replace(/\s+$/, '')).join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
}

/**
 * Join the pages into one document.
 *
 * `markers` writes a `--- Page N ---` banner before each page so the output stays navigable in a text
 * editor: a 200-page contract otherwise reads as one undifferentiated wall of text, and there is no
 * way back to "which page said that". Off by default so the output is the text and nothing else.
 */
export function assembleDocument(pages: string[], markers: boolean): string {
    const body = pages
        .map((text, index) => (markers ? `--- Page ${index + 1} ---\n${text}` : text))
        .join('\n\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return body ? `${body}\n` : '';
}

/** Pages that carry no text at all — the scan-detection signal. */
export function emptyPageCount(pages: string[]): number {
    return pages.filter((text) => !text.trim()).length;
}

/** `report.pdf` → `report.txt`, keeping the original stem. */
export function textFileName(pdfName: string): string {
    return `${String(pdfName || 'document').replace(/\.pdf$/i, '')}.txt`;
}

async function extract(file: File): Promise<void> {
    // Imported here, not at module scope: pdf.js touches DOMMatrix/canvas globals the moment it loads,
    // and the pure helpers above must stay importable in a jsdom test.
    const pdfjsLib = await import('pdfjs-dist');
    const arrayBuffer = await readFileAsArrayBuffer(file);
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer as ArrayBuffer }).promise;
    const texts: string[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        texts.push(pageTextFromItems(content.items as TextItem[]));
        page.cleanup();
    }

    const empty = emptyPageCount(texts);
    const notice = document.getElementById('pdf-to-text-notice');
    if (empty === texts.length) {
        // A scan: no text layer anywhere. Say so and point at OCR rather than downloading 0 bytes.
        if (notice) notice.classList.remove('hidden');
        showAlert(
            'No text layer found',
            'This PDF looks like a scan — every page is an image, so there is no text to extract. Use OCR PDF to recognise the text first, then come back.'
        );
        return;
    }

    // Some pages empty, not all: extract what exists, but tell the visitor which pages are images.
    if (notice) {
        const label = notice.querySelector('[data-empty-pages]');
        if (label) {
            label.textContent = String(empty);
            notice.classList.toggle('hidden', empty === 0);
        }
    }

    const markers = (document.getElementById('pdf-to-text-markers') as HTMLInputElement | null)?.checked ?? false;
    const text = assembleDocument(texts, markers);
    downloadFile(new Blob([text], { type: 'text/plain;charset=utf-8' }), textFileName(file.name));
}

export async function pdfToText(): Promise<void> {
    const file = state.files[0];
    if (!file) {
        showAlert('No file', 'Please select a PDF file first.');
        return;
    }

    showLoader('Extracting text...');
    try {
        await extract(file);
    } catch (error) {
        console.error(error);
        showAlert('Conversion Error', 'Could not read the text of this PDF. It may be encrypted, corrupted or image-based.');
    } finally {
        hideLoader();
    }
}
