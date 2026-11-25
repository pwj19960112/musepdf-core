import { showLoader, hideLoader, showAlert } from '../ui.js';
import { downloadFile } from '../utils/helpers.js';
import { state } from '../state.js';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';

/**
 * Attach files to a PDF — the PDF equivalent of an email attachment.
 *
 * The payload lives in the document's `/Names /EmbeddedFiles` name tree, so readers that support
 * portfolios and attachments (Acrobat, PDF Expert, Firefox, most DMS systems) show it in their
 * attachments panel. This matters for real paperwork: a contract travels with its signed annexes, an
 * invoice with its timesheet, a drawing with its source CAD file.
 *
 * The PDF is edited at the file level, not re-rendered: pages, bookmarks, forms and metadata are exactly
 * as they were, and the only difference is the new entries in the name tree. Nothing is uploaded.
 *
 * Every run starts from the file the browser holds, never from a document this tool already edited, so
 * clicking twice cannot attach the same file twice.
 */

/** The files a reader would find in the attachments panel today. */
export function attachmentNames(doc: PDFDocument): string[] {
    try {
        const ctx = doc.context;
        const names = ctx.lookup(doc.catalog.get(PDFName.of('Names')));
        if (!(names instanceof PDFDict)) return [];
        const tree = ctx.lookup(names.get(PDFName.of('EmbeddedFiles')));
        const found: string[] = [];

        const key = (value: any): string => {
            try {
                if (value instanceof PDFHexString) return value.decodeText();
                if (value instanceof PDFString) return value.decodeText();
                if (value instanceof PDFName) return value.asString().replace(/^\//, '');
            } catch {
                /* a name that cannot be decoded is not worth failing the tool over */
            }
            return '';
        };

        const walk = (node: any, depth: number): void => {
            if (depth > 8 || !(node instanceof PDFDict)) return;
            const entries = ctx.lookup(node.get(PDFName.of('Names')));
            if (entries instanceof PDFArray) {
                for (let i = 0; i + 1 < entries.size(); i += 2) {
                    const name = key(entries.get(i));
                    if (name) found.push(name);
                }
            }
            const kids = ctx.lookup(node.get(PDFName.of('Kids')));
            if (kids instanceof PDFArray) {
                for (let i = 0; i < kids.size(); i++) walk(ctx.lookup(kids.get(i)), depth + 1);
            }
        };

        walk(tree, 0);
        return found;
    } catch (error) {
        console.error('add-attachments: could not read the existing attachments', error);
        return [];
    }
}

/** A unique entry name inside the document: `quote.pdf`, then `quote (2).pdf`. */
export function uniqueName(name: string, taken: Set<string>): string {
    const clean = String(name ?? '').trim() || 'attachment.bin';
    if (!taken.has(clean.toLowerCase())) {
        taken.add(clean.toLowerCase());
        return clean;
    }
    const dot = clean.lastIndexOf('.');
    const stem = dot > 0 ? clean.slice(0, dot) : clean;
    const ext = dot > 0 ? clean.slice(dot) : '';
    let n = 2;
    while (taken.has(`${stem} (${n})${ext}`.toLowerCase())) n++;
    const candidate = `${stem} (${n})${ext}`;
    taken.add(candidate.toLowerCase());
    return candidate;
}

const sizeLabel = (n: number) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

/** Files chosen in the panel, kept between re-renders of the list. */
let pending: File[] = [];

function renderPending(): void {
    const list = document.getElementById('attachment-list');
    if (!list) return;
    list.textContent = '';
    pending.forEach((file, index) => {
        const row = document.createElement('li');
        row.className = 'flex items-center justify-between gap-3 text-sm py-1 border-b border-gray-800 last:border-0';
        row.dataset.attachmentName = file.name;

        const label = document.createElement('span');
        label.className = 'text-gray-200 break-all';
        label.textContent = file.name;
        label.title = file.name;

        const meta = document.createElement('span');
        meta.className = 'flex items-center gap-3 whitespace-nowrap';

        const size = document.createElement('span');
        size.className = 'text-xs text-gray-500';
        size.textContent = sizeLabel(file.size);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'text-red-400 hover:text-red-300';
        remove.textContent = '×';
        remove.setAttribute('aria-label', `Remove ${file.name}`);
        remove.addEventListener('click', () => {
            pending.splice(index, 1);
            renderPending();
        });

        meta.append(size, remove);
        row.append(label, meta);
        list.appendChild(row);
    });

    const note = document.getElementById('attachment-selected');
    if (note) {
        note.textContent = pending.length
            ? `${pending.length} file(s) will be embedded: ${pending.map((f) => f.name).join(', ')}.`
            : 'No files chosen yet.';
    }
    const btn = document.getElementById('process-btn') as HTMLButtonElement | null;
    if (btn) btn.disabled = pending.length === 0;
}

export function setupAddAttachments(): void {
    pending = [];

    const input = document.getElementById('attachment-input') as HTMLInputElement | null;
    if (input) {
        input.value = '';
        input.onchange = () => {
            pending.push(...Array.from(input.files ?? []));
            renderPending();
        };
    }

    const existing = document.getElementById('attachments-existing');
    const doc = state.pdfDoc as PDFDocument | null;
    if (existing) {
        if (!doc) {
            existing.textContent = 'Add the PDF, then choose the files to embed in it.';
        } else {
            let names: string[] = [];
            try {
                names = attachmentNames(doc);
            } catch {
                names = [];
            }
            existing.textContent = names.length
                ? `This PDF already carries ${names.length} attachment(s): ${names.join(', ')}. New files are added alongside them.`
                : 'This PDF carries no attachments yet.';
        }
    }
    renderPending();
}

export async function addAttachments(): Promise<void> {
    const file = (state.files ?? [])[0] as File | undefined;
    if (!file) {
        showAlert('No file', 'Please select a PDF file first.');
        return;
    }
    if (!pending.length) {
        showAlert('Nothing to attach', 'Choose at least one file to embed in the PDF.');
        return;
    }

    showLoader('Attaching the files...');
    try {
        // Load the ORIGINAL bytes: state.pdfDoc may already have been edited by an earlier run of this
        // or another tool, and attaching should never depend on that.
        const bytes = await file.arrayBuffer();
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        if (doc.isEncrypted) {
            showAlert('Protected PDF', 'This PDF is password-protected. Decrypt it first, then attach the files.');
            return;
        }

        const taken = new Set(attachmentNames(doc).map((name) => name.toLowerCase()));
        const attached: { name: string; size: number }[] = [];

        for (const item of pending) {
            const data = new Uint8Array(await item.arrayBuffer());
            const name = uniqueName(item.name, taken);
            doc.attach(data, name, {
                mimeType: item.type || 'application/octet-stream',
                description: 'Attached with MusePDF',
                creationDate: new Date(),
                modificationDate: new Date(),
            });
            attached.push({ name, size: data.length });
        }

        doc.setProducer('MusePDF');
        const stem = String(file.name).replace(/\.pdf$/i, '');
        const out = await doc.save();
        downloadFile(new Blob([out as unknown as BlobPart], { type: 'application/pdf' }), `${stem}-attachments.pdf`);

        const result = document.getElementById('attachments-result');
        if (result) {
            result.textContent = `${attached.length} file(s) embedded: ${attached.map((entry) => `${entry.name} (${sizeLabel(entry.size)})`).join(', ')}. Open the attachments panel of your PDF reader to see them.`;
        }

        // The panel now describes the file that was just written, so a second click cannot double-attach.
        const existing = document.getElementById('attachments-existing');
        if (existing) {
            existing.textContent = `The saved PDF carries ${taken.size} attachment(s): ${[...taken].join(', ')}.`;
        }
        pending = [];
        const input = document.getElementById('attachment-input') as HTMLInputElement | null;
        if (input) input.value = '';
        renderPending();
    } catch (error) {
        console.error('add-attachments:', error);
        showAlert('Attach Error', 'Could not embed these files. The PDF may be encrypted, damaged, or one of the files may be unreadable.');
    } finally {
        hideLoader();
    }
}
