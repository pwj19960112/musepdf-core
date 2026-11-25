import { showLoader, hideLoader, showAlert } from '../ui.js';
import { downloadFile } from '../utils/helpers.js';
import { state } from '../state.js';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { readOutline, type OutlineEntry } from './pdf-outline.js';

/**
 * Split a PDF into one file per TOP-LEVEL bookmark.
 *
 * A 600-page manual is almost always already organised in its outline — Part I, Part II, the appendix —
 * and cutting it up by hand means finding every chapter start twice. This reads the outline the
 * document already carries (the same reader Table of Contents and Edit Bookmarks use, so the three tools
 * can never disagree about where a chapter starts) and writes one PDF per top-level entry.
 *
 * A top-level entry owns the pages from its own target up to the page before the next top-level entry.
 * Nested entries are ignored on purpose: exporting a file per sub-section turns a 12-chapter book into
 * 140 one-page files, which is never what "split by bookmarks" means.
 *
 * Two judgements worth stating:
 *   - The first bookmark rarely starts on page 1 (a cover and a title page come first). Those pages are
 *     emitted as `Front matter` rather than silently dropped, so the parts always add up to the source.
 *   - An entry whose destination cannot be resolved (a named destination in a name tree, a broken
 *     reference) is skipped with a note, because guessing a page would put the wrong pages in the file.
 */

/** One output part, with the bookmark title it takes its name from. */
export type BookmarkPart = { title: string; start: number; end: number };

/**
 * Turn outline entries into page ranges.
 *
 * `entries` is the flat, document-ordered outline (`depth` 0 = top level). Ranges are 1-based and
 * inclusive, and they cover the document exactly once — gaps become a `Front matter` / `Untitled`
 * part, never a hole.
 */
export function bookmarkRanges(entries: OutlineEntry[], pageCount: number): BookmarkPart[] {
    const total = Math.max(0, Math.trunc(pageCount));
    if (!total) return [];

    const starts = entries
        .filter((entry) => Number(entry.depth) === 0)
        .map((entry) => ({ title: String(entry.title ?? '').trim(), page: Number(entry.page) || 0 }))
        .filter((entry) => entry.page >= 1 && entry.page <= total)
        // Document order is what the outline promises; sort anyway, because a malformed `/Next` chain
        // can hand them over out of order and a range built from an unsorted list would overlap.
        .sort((a, b) => a.page - b.page);

    if (!starts.length) return [];

    const parts: BookmarkPart[] = [];
    if (starts[0].page > 1) {
        parts.push({ title: 'Front matter', start: 1, end: starts[0].page - 1 });
    }

    const seen = new Set<number>();
    for (let i = 0; i < starts.length; i++) {
        const start = starts[i].page;
        if (seen.has(start)) continue; // two bookmarks on the same page: the first one owns it
        seen.add(start);
        const next = starts.slice(i + 1).find((entry) => entry.page > start);
        const end = next ? next.page - 1 : total;
        if (end < start) continue;
        parts.push({ title: starts[i].title || `Page ${start}`, start, end });
    }

    return parts;
}

/**
 * A bookmark title as a file name: no path separators, no characters Windows/macOS refuse, no leading
 * dots, and short enough to survive a ZIP extraction on every platform.
 */
export function safePartName(title: string, fallback = 'part'): string {
    const cleaned = String(title ?? '')
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '-')
        .replace(/\s+/g, ' ')
        .replace(/-{2,}/g, '-')
        .trim()
        .replace(/^[.\-\s]+/, '')
        .replace(/[.\s]+$/, '');
    const name = cleaned.slice(0, 80).trim() || fallback;
    return name;
}

/** Give every part a unique `<title>.pdf` name, numbered only where two titles collide. */
export function partNames(parts: BookmarkPart[]): string[] {
    const used = new Map<string, number>();
    return parts.map((part, index) => {
        const base = safePartName(part.title, `Part ${index + 1}`);
        const key = base.toLowerCase();
        const seen = used.get(key) ?? 0;
        used.set(key, seen + 1);
        return `${seen === 0 ? base : `${base} (${seen + 1})`}.pdf`;
    });
}

/** Read the outline of the document that is already loaded. */
function currentOutline(): OutlineEntry[] {
    const doc = state.pdfDoc as PDFDocument | null;
    if (!doc) return [];
    try {
        return readOutline(doc);
    } catch (error) {
        console.error('split-pdf-by-bookmarks: could not read the outline', error);
        return [];
    }
}

/** The panel: list what each top-level bookmark will produce, before anything is written. */
export function setupSplitByBookmarks(): void {
    const note = document.getElementById('split-bookmarks-note');
    const list = document.getElementById('split-bookmarks-list');
    if (!note || !list) return;
    list.textContent = '';

    const doc = state.pdfDoc as PDFDocument | null;
    if (!doc) {
        note.textContent = 'Add the PDF to load its bookmarks.';
        return;
    }

    const entries = currentOutline();
    const topLevel = entries.filter((entry) => Number(entry.depth) === 0);
    const parts = bookmarkRanges(entries, doc.getPageCount());
    if (!parts.length) {
        note.textContent = topLevel.length
            ? 'This PDF has bookmarks, but none of them points at a page this reader can resolve. Use Edit Bookmarks to fix the targets first.'
            : 'This PDF has no bookmarks, so there is nothing to split by. Add bookmarks with Edit Bookmarks, or split by page range instead.';
        const link = document.createElement('a');
        link.href = '/edit-bookmarks/';
        link.textContent = 'Open Edit Bookmarks';
        link.className = 'inline-block mt-2 text-indigo-300 underline';
        list.appendChild(link);
        return;
    }

    note.textContent = `${parts.length} file(s) will be written — one per top-level bookmark, in document order.`;
    const names = partNames(parts);
    parts.forEach((part, index) => {
        const row = document.createElement('li');
        row.className = 'flex items-baseline justify-between gap-3 py-1 border-b border-gray-800 last:border-0';
        row.dataset.partRange = `${part.start}-${part.end}`;

        const name = document.createElement('span');
        name.className = 'text-sm text-gray-200 break-all';
        name.textContent = names[index];

        const range = document.createElement('span');
        range.className = 'text-xs text-gray-500 whitespace-nowrap';
        range.textContent = part.start === part.end ? `page ${part.start}` : `pages ${part.start}-${part.end}`;

        row.append(name, range);
        list.appendChild(row);
    });
}

export async function splitByBookmarks(): Promise<void> {
    const doc = state.pdfDoc as PDFDocument | null;
    const file = (state.files ?? [])[0] as File | undefined;
    if (!doc || !file) {
        showAlert('No file', 'Please select a PDF file first.');
        return;
    }

    const entries = currentOutline();
    if (!entries.length) {
        showAlert(
            'No bookmarks',
            'This PDF has no outline, so there is nothing to split by. Add bookmarks with Edit Bookmarks first, or use Split PDF for page ranges.'
        );
        return;
    }

    const parts = bookmarkRanges(entries, doc.getPageCount());
    if (!parts.length) {
        showAlert(
            'No usable bookmarks',
            'The outline entries in this PDF do not point at pages this reader can resolve, so no parts could be cut. Edit the bookmarks to set their target pages first.'
        );
        return;
    }

    showLoader(`Writing ${parts.length} file(s)...`);
    try {
        const names = partNames(parts);
        const stem = String(file.name).replace(/\.pdf$/i, '');
        const written: Blob[] = [];

        for (const part of parts) {
            const out = await PDFDocument.create();
            const indices: number[] = [];
            for (let page = part.start; page <= part.end; page++) indices.push(page - 1);
            const copied = await out.copyPages(doc, indices);
            for (const page of copied) out.addPage(page);
            out.setTitle(part.title);
            out.setProducer('MusePDF');
            out.setCreator('MusePDF — split by bookmarks');
            written.push(new Blob([(await out.save()) as unknown as BlobPart], { type: 'application/pdf' }));
        }

        if (written.length === 1) {
            downloadFile(written[0], names[0]);
        } else {
            const zip = new JSZip();
            written.forEach((blob, index) => zip.file(names[index], blob));
            const archive = await zip.generateAsync({ type: 'blob' });
            downloadFile(archive, `${stem}-bookmarks.zip`);
        }

        const result = document.getElementById('split-bookmarks-result');
        if (result) {
            result.textContent = `${written.length} file(s): ${parts.map((part, i) => `${names[i]} (pages ${part.start}-${part.end})`).join(' · ')}`;
        }
    } catch (error) {
        console.error('split-pdf-by-bookmarks:', error);
        showAlert('Split Error', 'Could not split this PDF by its bookmarks. The file may be encrypted or its outline may be damaged.');
    } finally {
        hideLoader();
    }
}
