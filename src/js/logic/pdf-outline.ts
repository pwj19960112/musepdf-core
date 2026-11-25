import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString } from 'pdf-lib';

/**
 * Reading a PDF outline (the bookmarks panel every reader shows).
 *
 * The outline is a tree hanging off the catalog: `catalog /Outlines → /First → /Next …`, each item a
 * dictionary with a `/Title`, a `/Parent`, and a destination (`/Dest`, or an `/A` action whose `/D`
 * is that destination). pdf-lib has no API for it, so this module reads the structure at the
 * dictionary level.
 *
 * Shared by Edit Bookmarks (which then rewrites the tree) and Table of Contents (which turns it into
 * a printed page), so both tools agree on what an entry's target page is. `depth` is the nesting
 * level: 0 for a top-level chapter, 1 for its sections. Edit Bookmarks flattens it away because its
 * UI is a flat list; Table of Contents indents by it.
 */

/** One outline item, in document order. */
export type OutlineEntry = {
    /** Display text of the entry. */
    title: string;
    /** 1-based page the entry jumps to; 0 when the destination could not be resolved. */
    page: number;
    /** Nesting level, 0-based. */
    depth: number;
};

/** Decode `/Title`, which is a PDF string (literal or hex) and may be UTF-16BE. */
export function decodeTitle(value: unknown): string {
    try {
        if (value instanceof PDFHexString) return value.decodeText();
        if (value instanceof PDFString) return value.decodeText();
        if (typeof value === 'string') return value;
    } catch {
        /* a title that cannot be decoded is shown empty rather than crashing the tool */
    }
    return '';
}

/**
 * The 1-based page an outline item points at, or 0 when it points somewhere this reader cannot
 * resolve (a named destination defined in a name tree, an external file, a broken reference).
 */
export function destinationPage(doc: PDFDocument, item: PDFDict): number {
    const ctx = doc.context;
    const pages = doc.getPages();
    const indexOf = (target: any): number => {
        if (!target) return 0;
        if (target instanceof PDFRef) {
            const found = pages.findIndex((page) => page.ref.toString() === target.toString());
            return found >= 0 ? found + 1 : 0;
        }
        if (target instanceof PDFNumber) {
            const n = target.asNumber();
            return n >= 0 && n < pages.length ? n + 1 : 0;
        }
        if (target instanceof PDFDict) return indexOf(target.get(PDFName.of('D')));
        return 0;
    };

    const resolve = (dest: any): number => {
        const value = dest instanceof PDFRef ? ctx.lookup(dest) : dest;
        if (value instanceof PDFArray) return indexOf(value.get(0));
        if (value instanceof PDFName || value instanceof PDFString) {
            // A named destination: the flat /Dests dictionary is the common case.
            const dests = ctx.lookup(doc.catalog.get(PDFName.of('Dests')));
            if (dests instanceof PDFDict) return resolve(dests.get(value as PDFName));
            return 0;
        }
        return 0;
    };

    const direct = item.get(PDFName.of('Dest'));
    if (direct) return resolve(direct);

    const action = ctx.lookup(item.get(PDFName.of('A')));
    if (action instanceof PDFDict) {
        const kind = action.get(PDFName.of('S'));
        if (kind instanceof PDFName && kind.asString() === '/GoTo') return resolve(action.get(PDFName.of('D')));
    }
    return 0;
}

/**
 * Read the whole outline, flattened depth-first in document order.
 *
 * The `/Next` chain is walked with a hard cap: a malformed file can describe a cycle, and a loop here
 * would hang the page instead of showing an outline.
 */
export function readOutline(doc: PDFDocument): OutlineEntry[] {
    const ctx = doc.context;
    const outlines = ctx.lookup(doc.catalog.get(PDFName.of('Outlines')));
    if (!(outlines instanceof PDFDict)) return [];

    const entries: OutlineEntry[] = [];
    const visit = (first: any, depth: number): void => {
        if (depth > 8 || entries.length > 2000) return;
        let node = first instanceof PDFRef ? ctx.lookup(first) : first;
        let guard = 0;
        while (node instanceof PDFDict && guard++ < 2000) {
            entries.push({
                title: decodeTitle(ctx.lookup(node.get(PDFName.of('Title')))),
                page: destinationPage(doc, node),
                depth,
            });
            const child = node.get(PDFName.of('First'));
            if (child) visit(child, depth + 1);
            const next = node.get(PDFName.of('Next'));
            node = next ? (next instanceof PDFRef ? ctx.lookup(next) : next) : undefined;
        }
    };
    visit(outlines.get(PDFName.of('First')), 0);
    return entries;
}
