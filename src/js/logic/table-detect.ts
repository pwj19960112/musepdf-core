/**
 * Table detection, shared by PDF to CSV and PDF to Excel.
 *
 * A PDF has no tables. It has text runs with a position and a width, and the "table" is an illusion
 * produced by lining those runs up. So both tools rebuild the grid from pdf.js `getTextContent()`
 * items in four steps:
 *
 *   1. GROUP BY BASELINE. Runs whose y is within a fraction of the font size are one row. A fraction
 *      (not a fixed number of points) is what keeps a 6 pt footnote and a 14 pt heading from being
 *      merged with the body text between them.
 *   2. SPLIT BY GAP. Inside a row, a run that starts further than ~0.9 em from where the previous one
 *      ended is a new cell. Two words of ordinary prose are ~0.25 em apart, so the threshold sits well
 *      clear of a space and well under a column gutter.
 *   3. SNAP TO COLUMNS. Per-row splitting alone produces ragged rows (an empty cell simply is not
 *      there). Column anchors are therefore collected from the rows that agree on a column count, and
 *      every row is then re-projected onto those anchors — a missing cell becomes an empty string,
 *      which is what a spreadsheet expects.
 *   4. DECIDE WHETHER IT IS A TABLE AT ALL. Two columns of body text line up exactly like a
 *      two-column table, so geometry alone is not enough: a candidate must also READ like a table —
 *      mostly short cells, and at least one column of uniformly short values. A page that fails
 *      returns `null` and the tools say "no table found" instead of exporting the page's prose as a
 *      one-column CSV.
 *
 * The limits are honest: merged cells are not detected, columns that are right-aligned with very
 * different widths can split into two anchors, and a scanned page has no text to detect anything in.
 * The tools' copy says so rather than pretending to be a spreadsheet importer.
 */

/** One pdf.js text item — only the fields this module reads. */
export type TextItem = {
    str?: string;
    transform?: number[];
    width?: number;
};

/** A run of text on one baseline, with the x range it covers. */
export type Run = { x: number; end: number; text: string };

/** One baseline: everything that shares a y, split into cells. */
export type Line = { y: number; size: number; cells: Run[] };

export type Table = { rows: string[][]; columns: number };

/** Fallback when a run carries no usable font scale in its transform. */
const DEFAULT_SIZE = 10;
/** Average advance width of a proportional font, in em — only used when pdf.js reports no width. */
const CHAR_EM = 0.5;

function sizeOf(item: TextItem): number {
    const t = Array.isArray(item.transform) ? item.transform : null;
    const scale = t && Number.isFinite(t[3]) ? Math.abs(t[3]) : 0;
    return scale > 0.5 && scale < 200 ? scale : DEFAULT_SIZE;
}

function widthOf(item: TextItem, size: number): number {
    if (typeof item.width === 'number' && Number.isFinite(item.width) && item.width > 0) return item.width;
    return String(item.str ?? '').length * size * CHAR_EM;
}

/**
 * Split one baseline's runs into cells.
 *
 * `size` decides the gap: a 9 pt table and an 18 pt poster have completely different gutters, and a
 * fixed threshold would merge cells in one and shatter them in the other.
 */
export function splitCells(runs: Run[], size: number): Run[] {
    const sorted = [...runs].sort((a, b) => a.x - b.x);
    const threshold = Math.max(6, size * 0.9);
    const cells: Run[] = [];

    for (const run of sorted) {
        const last = cells[cells.length - 1];
        const gap = last ? run.x - last.end : Infinity;
        if (last && gap <= threshold) {
            // Same cell. Two runs in a cell are usually separated by positioning, not by a space
            // character, so the space has to be re-inserted or "Total" + "1,024" becomes "Total1,024".
            const needsSpace = gap > 0.5 && !/\s$/.test(last.text) && !/^\s/.test(run.text);
            last.text += (needsSpace ? ' ' : '') + run.text;
            last.end = Math.max(last.end, run.end);
        } else {
            cells.push({ ...run });
        }
    }

    return cells.map((cell) => ({ ...cell, text: cell.text.replace(/\s+/g, ' ').trim() }));
}

/**
 * Group the text items of one page into baselines, in reading order (top to bottom, then left to
 * right), each already split into cells.
 */
export function linesFromItems(items: TextItem[]): Line[] {
    const rows: { y: number; size: number; runs: Run[] }[] = [];

    for (const item of items) {
        const text = typeof item.str === 'string' ? item.str : '';
        if (!text.trim()) continue; // a pure space is a gap, not content
        const t = Array.isArray(item.transform) ? item.transform : null;
        if (!t) continue;
        const x = t[4];
        const y = t[5];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

        const size = sizeOf(item);
        const tolerance = Math.max(2.5, Math.min(6, size * 0.35));
        let row = rows.find((candidate) => Math.abs(candidate.y - y) <= tolerance);
        if (!row) {
            row = { y, size, runs: [] };
            rows.push(row);
        }
        row.runs.push({ x, end: x + widthOf(item, size), text });
    }

    // PDF user space grows upwards, so reading order is DESCENDING y.
    rows.sort((a, b) => b.y - a.y);
    return rows.map((row) => ({ y: row.y, size: row.size, cells: splitCells(row.runs, row.size) }));
}

/** The column count most rows agree on (at least 2), or 0 when no two rows agree. */
function modalColumnCount(lines: Line[]): number {
    const counts = new Map<number, number>();
    for (const line of lines) counts.set(line.cells.length, (counts.get(line.cells.length) ?? 0) + 1);

    let best = 0;
    let bestRows = 0;
    for (const [count, rows] of counts) {
        if (count < 2) continue;
        if (rows > bestRows || (rows === bestRows && count > best)) {
            best = count;
            bestRows = rows;
        }
    }
    return best;
}

/**
 * The x positions the columns start at.
 *
 * Only rows that agree on the modal column count contribute: a heading or a footer line would
 * otherwise drag an anchor to wherever its first word happens to sit.
 */
export function columnAnchors(lines: Line[], tolerance = 12): number[] {
    const count = modalColumnCount(lines);
    if (!count) return [];

    const xs = lines
        .filter((line) => line.cells.length === count)
        .flatMap((line) => line.cells.map((cell) => cell.x))
        .sort((a, b) => a - b);

    const clusters: { sum: number; n: number; at: number }[] = [];
    for (const x of xs) {
        const last = clusters[clusters.length - 1];
        if (last && x - last.at <= tolerance) {
            last.sum += x;
            last.n += 1;
            last.at = last.sum / last.n;
        } else {
            clusters.push({ sum: x, n: 1, at: x });
        }
    }
    return clusters.map((cluster) => cluster.sum / cluster.n);
}

/**
 * Does this grid read like a table rather than like body text that happens to have two columns?
 *
 * `short` is the share of cells that are headline-length or less; `narrow` asks whether at least one
 * column is uniformly short, which is true of every real table (a label, a count, a date) and false of
 * two columns of prose.
 */
export function looksTabular(rows: string[][]): boolean {
    if (rows.length < 2 || (rows[0]?.length ?? 0) < 2) return false;
    const cells = rows.flat();
    if (cells.filter((cell) => cell.length > 0).length < 4) return false;

    const short = cells.filter((cell) => cell.length <= 40).length / cells.length;
    if (short < 0.6) return false;

    const columns = rows[0].map((_, index) => rows.map((row) => row[index] ?? ''));
    return columns.some((column) => column.every((cell) => cell.length <= 60) && column.some((cell) => cell.length > 0));
}

/**
 * Rebuild the page's table, or `null` when the page does not contain one this module can trust.
 *
 * Rows are re-projected onto the anchors, so every row has exactly one entry per column (missing cells
 * become `''`). A row whose runs cannot all be placed inside the grid is not part of the table and is
 * dropped — that is how a page number or a running head stays out of the export.
 */
export function detectTable(items: TextItem[]): Table | null {
    const lines = linesFromItems(items);
    if (lines.length < 2) return null;

    const anchors = columnAnchors(lines);
    if (anchors.length < 2) return null;

    const spacing = anchors.slice(1).reduce((min, x, i) => Math.min(min, x - anchors[i]), Infinity);
    const tolerance = Math.max(8, Number.isFinite(spacing) ? spacing / 2 : 0);

    const rows: string[][] = [];
    for (const line of lines) {
        const row: string[] = anchors.map(() => '');
        let mapped = 0;
        let offGrid = 0;

        for (const cell of line.cells) {
            let best = -1;
            let bestDistance = Infinity;
            anchors.forEach((anchor, index) => {
                const distance = Math.abs(cell.x - anchor);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    best = index;
                }
            });
            if (best < 0 || bestDistance > tolerance) {
                offGrid += 1;
                continue;
            }
            row[best] = row[best] ? `${row[best]} ${cell.text}` : cell.text;
            mapped += 1;
        }

        // A row needs two placed cells and nothing floating outside the grid: one lone run in the
        // margin is a page number, not a row with one column.
        if (mapped >= 2 && offGrid === 0) rows.push(row);
    }

    if (rows.length < 2) return null;

    // Drop empty columns (an anchor cluster that ended up with no content) and fully empty rows.
    const kept = rows[0].map((_, index) => index).filter((index) => rows.some((row) => (row[index] ?? '').trim()));
    const grid = rows
        .map((row) => kept.map((index) => row[index] ?? ''))
        .filter((row) => row.some((cell) => cell.length > 0));

    if (grid.length < 2 || (grid[0]?.length ?? 0) < 2) return null;
    if (!looksTabular(grid)) return null;

    return { rows: grid, columns: grid[0].length };
}

/* ------------------------------------------------------------------------ CSV */

/**
 * One RFC 4180 field: quoted when it contains a comma, a quote or a line break, with inner quotes
 * doubled. Values are otherwise written exactly as the page showed them — no trimming of numbers,
 * no locale conversion, because the point is a lossless copy of what the PDF said.
 */
export function csvField(value: unknown): string {
    const text = value === undefined || value === null ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A whole table as RFC 4180 text: CRLF between records, one trailing newline. */
export function tableToCsv(rows: string[][]): string {
    if (!rows.length) return '';
    return `${rows.map((row) => row.map(csvField).join(',')).join('\r\n')}\r\n`;
}
