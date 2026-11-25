import { showLoader, hideLoader, showAlert } from '../ui.js';
import { downloadFile, readFileAsArrayBuffer } from '../utils/helpers.js';
import { state } from '../state.js';
import JSZip from 'jszip';
import { detectTable, tableToCsv, type TextItem } from './table-detect.js';

/**
 * PDF to CSV.
 *
 * Reads each page's text layer with pdf.js and rebuilds the tables on it (see table-detect.ts for the
 * four steps and what they cannot do). The output is **one CSV per page that has a table**: a single
 * page gives you a single `.csv`; several pages give you one ZIP with a CSV per page, because a
 * spreadsheet column means the same thing on every row and gluing page 5's table onto page 2's would
 * produce a file that is wrong everywhere except by accident. There is no "one file with page
 * separators" variant for exactly that reason.
 *
 * Nothing leaves the browser: the bytes come from `readFileAsArrayBuffer`, pdf.js parses them in the
 * page, and the result is built as a Blob and handed to the downloader.
 */

export type PageTable = { page: number; rows: string[][] };

/** `report.pdf` → `report` — the stem both output names are built from. */
export function fileStem(name: string): string {
    return String(name || 'document').replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]+/g, '-');
}

/** `report.pdf` + 3 → `report-page-03.csv`. Zero padded so an archive sorts in page order. */
export function csvName(pdfName: string, page: number): string {
    return `${fileStem(pdfName)}-page-${String(page).padStart(2, '0')}.csv`;
}

/** `report.pdf` → `report-tables.zip`. */
export function zipName(pdfName: string): string {
    return `${fileStem(pdfName)}-tables.zip`;
}

/** Pages that produced a trustworthy table, in page order. */
export function pagesWithTables(tables: PageTable[]): PageTable[] {
    return tables.filter((table) => table.rows.length >= 2 && table.rows[0].length >= 2);
}

async function extract(file: File): Promise<PageTable[]> {
    // Imported here, not at module scope: pdf.js touches DOMMatrix/canvas globals the moment it loads,
    // and the pure helpers above must stay importable in a jsdom test.
    const pdfjsLib = await import('pdfjs-dist');
    const data = await readFileAsArrayBuffer(file);
    const doc = await pdfjsLib.getDocument({ data: data as ArrayBuffer }).promise;
    const tables: PageTable[] = [];

    for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const table = detectTable(content.items as TextItem[]);
        if (table) tables.push({ page: i, rows: table.rows });
        page.cleanup();
    }

    return pagesWithTables(tables);
}

function writeSummary(text: string): void {
    const node = document.querySelector('[data-table-summary]');
    if (node) node.textContent = text;
}

async function extractAndDownload(file: File): Promise<void> {
    const tables = await extract(file);

    if (!tables.length) {
        writeSummary('');
        showAlert(
            'No table found',
            'This PDF has no text-based table this tool can rebuild: either the pages carry no text at all (a scan — run OCR PDF first), or the content is not laid out as columns. Nothing was downloaded.'
        );
        return;
    }

    const pageList = tables.map((table) => table.page).join(', ');
    const cellCount = tables.reduce((total, table) => total + table.rows.length, 0);

    if (tables.length === 1) {
        const [table] = tables;
        const csv = tableToCsv(table.rows);
        writeSummary(`Table found on page ${table.page}: ${table.rows.length} rows × ${table.rows[0].length} columns.`);
        downloadFile(new Blob([csv], { type: 'text/csv;charset=utf-8' }), csvName(file.name, table.page));
        return;
    }

    // Several pages with a table: one CSV each, in one ZIP. Separate files keep every table's columns
    // meaning what they meant on their own page.
    const zip = new JSZip();
    for (const table of tables) zip.file(csvName(file.name, table.page), tableToCsv(table.rows));
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });

    writeSummary(`Tables found on ${tables.length} pages (${pageList}): ${cellCount} rows in total, one CSV per page in one ZIP.`);
    downloadFile(blob, zipName(file.name));
}

export async function pdfToCsv(): Promise<void> {
    const file = state.files[0];
    if (!file) {
        showAlert('No file', 'Please select a PDF file first.');
        return;
    }

    showLoader('Finding tables...');
    try {
        await extractAndDownload(file);
    } catch (error) {
        console.error(error);
        showAlert(
            'Conversion Error',
            'Could not read this PDF. It may be encrypted, corrupted or image-based — a scan has no text layer to rebuild a table from.'
        );
    } finally {
        hideLoader();
    }
}
