import { showLoader, hideLoader, showAlert } from '../ui.js';
import { downloadFile, readFileAsArrayBuffer } from '../utils/helpers.js';
import { state } from '../state.js';
import JSZip from 'jszip';
import { detectTable, type TextItem } from './table-detect.js';

/**
 * PDF to Excel.
 *
 * Same table detection as PDF to CSV (table-detect.ts), written out as a real `.xlsx` workbook —
 * one worksheet per page that has a table.
 *
 * WHY THE OOXML IS HAND-BUILT. A `.xlsx` is a ZIP of XML parts, and the only part a text table needs
 * is `xl/worksheets/sheetN.xml`. SheetJS would add ~400 KB to this chunk to write four small files,
 * and the site already ships JSZip for PDFs-to-ZIP, so the package is assembled here: content types,
 * the package relationship, the workbook, its relationships, a minimal style sheet, and one
 * worksheet per page.
 *
 * TWO DELIBERATE CHOICES about the cells:
 *   - Text is written as INLINE strings (`t="inlineStr"`), not through `sharedStrings.xml`. There is
 *     no shared-string table to keep consistent, so a cell value can never point at the wrong entry.
 *   - A cell that is unambiguously a number (`12`, `-3.5`, no thousands separator, no currency, no
 *     leading zero) is written as a NUMBER so the reader can sum the column. Everything else stays
 *     text — "1,024" and "007" are labels, and turning them into numbers would silently change what
 *     the document says.
 */

/** A1-style column reference for a zero-based index: 0 → A, 25 → Z, 26 → AA. */
export function columnLetter(index: number): string {
    let n = Math.max(0, Math.floor(index));
    let letters = '';
    do {
        letters = String.fromCharCode(65 + (n % 26)) + letters;
        n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return letters;
}

/** Escape a value for XML text content. */
export function xmlEscape(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
        // Control characters are illegal in XML 1.0 and make Excel refuse the file outright.
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/**
 * A value that is unambiguously a number, or `null` when it has to stay text.
 *
 * Leading zeros, thousands separators, currency symbols and trailing units all disqualify a cell: they
 * are part of what the document says, and Excel would drop them.
 */
export function numericValue(value: string): string | null {
    const text = String(value ?? '').trim();
    if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) return null;
    return text;
}

/** One `<c>` element: an inline string, or a number when the value is one. */
export function cellXml(ref: string, value: string): string {
    const number = numericValue(value);
    if (number !== null) return `<c r="${ref}"><v>${number}</v></c>`;
    const space = /^\s|\s$/.test(value) ? ' xml:space="preserve"' : '';
    return `<c r="${ref}" t="inlineStr"><is><t${space}>${xmlEscape(value)}</t></is></c>`;
}

/** One worksheet, rows and cells only — no styling, no dimensions, no merged ranges. */
export function sheetXml(rows: string[][]): string {
    const body = rows
        .map((row, rowIndex) => {
            const cells = row.map((value, columnIndex) => cellXml(`${columnLetter(columnIndex)}${rowIndex + 1}`, value)).join('');
            return `<row r="${rowIndex + 1}">${cells}</row>`;
        })
        .join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

/** `[Content_Types].xml` — one override per worksheet, plus the workbook and the style sheet. */
export function contentTypesXml(sheetCount: number): string {
    const sheets = Array.from({ length: sheetCount }, (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    ).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets}</Types>`;
}

export const PACKAGE_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

/**
 * A minimal style sheet. Nothing here is applied by a cell — it exists because Excel expects the part
 * to resolve (a workbook relationship that points at a missing `styles.xml` opens as a repair prompt).
 */
export const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/** The workbook part: one `<sheet>` per worksheet, in page order. */
export function workbookXml(sheetNames: string[]): string {
    const sheets = sheetNames
        .map((name, index) => `<sheet name="${xmlEscape(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
        .join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets}</sheets></workbook>`;
}

/** Workbook relationships: worksheets first (rId1…rIdN), then the style sheet. */
export function workbookRelsXml(sheetCount: number): string {
    const sheets = Array.from({ length: sheetCount }, (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
    ).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets}<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
}

/** Excel forbids these in a sheet name, and caps the length at 31 characters. */
export function sheetName(page: number, used: Set<string> = new Set()): string {
    const base = `Page ${page}`.slice(0, 31);
    let name = base;
    let suffix = 2;
    while (used.has(name)) name = `${base.slice(0, 31 - String(suffix).length - 1)}-${suffix++}`;
    used.add(name);
    return name;
}

export type WorkbookTable = { page: number; rows: string[][] };

/** Assemble the whole `.xlsx` package as a Blob. */
export async function workbookBlob(tables: WorkbookTable[]): Promise<Blob> {
    const used = new Set<string>();
    const names = tables.map((table) => sheetName(table.page, used));

    const zip = new JSZip();
    zip.file('[Content_Types].xml', contentTypesXml(tables.length));
    zip.file('_rels/.rels', PACKAGE_RELS_XML);
    zip.file('xl/workbook.xml', workbookXml(names));
    zip.file('xl/_rels/workbook.xml.rels', workbookRelsXml(tables.length));
    zip.file('xl/styles.xml', STYLES_XML);
    tables.forEach((table, index) => zip.file(`xl/worksheets/sheet${index + 1}.xml`, sheetXml(table.rows)));

    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** `report.pdf` → `report.xlsx`. */
export function excelName(pdfName: string): string {
    return `${String(pdfName || 'document').replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]+/g, '-')}.xlsx`;
}

async function extract(file: File): Promise<WorkbookTable[]> {
    const pdfjsLib = await import('pdfjs-dist');
    const data = await readFileAsArrayBuffer(file);
    const doc = await pdfjsLib.getDocument({ data: data as ArrayBuffer }).promise;
    const tables: WorkbookTable[] = [];

    for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const table = detectTable(content.items as TextItem[]);
        if (table) tables.push({ page: i, rows: table.rows });
        page.cleanup();
    }

    return tables;
}

function writeSummary(text: string): void {
    const node = document.querySelector('[data-table-summary]');
    if (node) node.textContent = text;
}

export async function pdfToExcel(): Promise<void> {
    const file = state.files[0];
    if (!file) {
        showAlert('No file', 'Please select a PDF file first.');
        return;
    }

    showLoader('Building the workbook...');
    try {
        const tables = await extract(file);
        if (!tables.length) {
            writeSummary('');
            showAlert(
                'No table found',
                'This PDF has no text-based table this tool can rebuild: either the pages carry no text at all (a scan — run OCR PDF first), or the content is not laid out as columns. Nothing was downloaded.'
            );
            return;
        }

        const blob = await workbookBlob(tables);
        const rows = tables.reduce((total, table) => total + table.rows.length, 0);
        writeSummary(
            `Table found on ${tables.length === 1 ? `page ${tables[0].page}` : `${tables.length} pages`}: ${rows} rows in ${tables.length} worksheet${tables.length === 1 ? '' : 's'}.`
        );
        downloadFile(blob, excelName(file.name));
    } catch (error) {
        console.error(error);
        showAlert(
            'Conversion Error',
            'Could not build the workbook from this PDF. It may be encrypted, corrupted or image-based — a scan has no text layer to rebuild a table from.'
        );
    } finally {
        hideLoader();
    }
}
