import { showLoader, hideLoader, showAlert } from '../ui.js';
import { downloadFile } from '../utils/helpers.js';
import { state } from '../state.js';
import { PDFDocument, type PDFPage } from 'pdf-lib';

/**
 * Overlay or underlay one PDF on another — the letterhead / pre-printed-form / watermark case.
 *
 * Two files, in the order they were added: the FIRST is the document, the SECOND is the layer. That
 * order matters and cannot be inferred, so the panel says it in words and the file list keeps the order
 * the user added them.
 *
 * FOREGROUND vs BACKGROUND is not cosmetic:
 *   "on top"  → the second PDF is drawn after the page's own content, so an opaque stamp, a signature or
 *               a revision banner covers what is underneath. This is what a watermark is.
 *   "under"   → the same page is drawn FIRST and the document's page is drawn over it, so a letterhead,
 *               a border or a scanned form shows through wherever the document does not paint. A white
 *               page area in the document would hide it — that is the honest behaviour of layering, not
 *               a bug.
 *
 * Both modes rebuild the pages, which is why the result is a clean, universally-openable file: the two
 * layers become page content. The trade-off is stated in the panel — interactive form fields and links in
 * the base document do not survive being flattened into a page.
 *
 * A shorter layer repeats its last page (a one-page letterhead over a fifty-page report); the option can
 * be turned off, in which case the pages past the end of the layer are copied unlayered.
 */

type Mode = 'top' | 'under';

function readOptions(): { mode: Mode; opacity: number; repeat: boolean } {
    const mode = ((document.getElementById('overlay-mode') as HTMLSelectElement | null)?.value || 'top') as Mode;
    const rawOpacity = Number.parseInt((document.getElementById('overlay-opacity') as HTMLInputElement | null)?.value ?? '100', 10);
    const repeat = (document.getElementById('overlay-repeat') as HTMLInputElement | null)?.checked ?? true;
    return {
        mode: mode === 'under' ? 'under' : 'top',
        opacity: Math.min(Math.max(Number.isFinite(rawOpacity) ? rawOpacity : 100, 5), 100) / 100,
        repeat,
    };
}

const bytesLabel = (n: number) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** The panel note: which file is the document, which is the layer, and what will happen. */
export function setupOverlay(): void {
    const note = document.getElementById('overlay-note');
    const btn = document.getElementById('process-btn') as HTMLButtonElement | null;
    // The shared upload path only reveals option blocks it knows about by slug; this one has to be shown here
    // or the mode/opacity controls and the button stay behind `hidden` and the page looks dead.
    document.getElementById('overlay-pdf-options')?.classList.remove('hidden');
    const files = (state.files ?? []) as File[];
    if (btn) btn.disabled = files.length < 2;
    if (!note) return;

    if (files.length === 0) {
        note.textContent = 'Add two PDFs: the document first, then the page to lay over it.';
        return;
    }
    if (files.length === 1) {
        note.textContent = `“${files[0].name}” is the document. Add the second PDF — the letterhead, watermark or form — to finish.`;
        return;
    }
    const base = files[0];
    const layer = files[1];
    const extra = files.length > 2 ? ` ${files.length - 2} more file(s) will be ignored: this tool uses the first two, in order.` : '';
    const { mode } = readOptions();
    note.textContent = `“${base.name}” (${bytesLabel(base.size)}) is the document; “${layer.name}” (${bytesLabel(layer.size)}) goes ${mode === 'under' ? 'underneath it' : 'on top'}.${extra}`;
}

export async function overlayPdf(): Promise<void> {
    const files = (state.files ?? []) as File[];
    if (files.length < 2) {
        showAlert('Two files needed', 'Add the document first, then the PDF to lay over it.');
        return;
    }

    const [baseFile, layerFile] = files;
    const { mode, opacity, repeat } = readOptions();

    showLoader('Layering the pages...');
    try {
        const baseBytes = await baseFile.arrayBuffer();
        const layerBytes = await layerFile.arrayBuffer();
        const base = await PDFDocument.load(baseBytes, { ignoreEncryption: true });
        const layer = await PDFDocument.load(layerBytes, { ignoreEncryption: true });

        if (base.isEncrypted || layer.isEncrypted) {
            showAlert('Protected PDF', 'One of these files is password-protected. Decrypt it first, then try again.');
            return;
        }

        const basePages = base.getPages();
        const layerPages = layer.getPages();
        if (!basePages.length || !layerPages.length) {
            showAlert('Empty PDF', 'One of the two files has no pages.');
            return;
        }

        const out = await PDFDocument.create();
        const embeddedBase = new Map<number, any>();
        const embeddedLayer = new Map<number, any>();

        const embedBase = async (index: number) => {
            if (!embeddedBase.has(index)) embeddedBase.set(index, await out.embedPage(basePages[index]));
            return embeddedBase.get(index);
        };
        const embedLayer = async (index: number) => {
            if (!embeddedLayer.has(index)) embeddedLayer.set(index, await out.embedPage(layerPages[index]));
            return embeddedLayer.get(index);
        };

        let repeated = 0;
        let skipped = 0;

        for (let i = 0; i < basePages.length; i++) {
            const source = basePages[i];
            const { width, height } = source.getSize();
            const page: PDFPage = out.addPage([width, height]);
            page.setRotation(source.getRotation());

            // The layer page for this sheet: same index, or the last one when the layer is shorter.
            let layerIndex = i;
            if (i >= layerPages.length) {
                if (!repeat) {
                    layerIndex = -1;
                    skipped++;
                } else {
                    layerIndex = layerPages.length - 1;
                    repeated++;
                }
            }

            const drawLayer = async (target: PDFPage) => {
                if (layerIndex < 0) return;
                const embedded = await embedLayer(layerIndex);
                const size = layerPages[layerIndex].getSize();
                // Contain, centred: identical page sizes are a 100% match, and a differently-shaped
                // layer shrinks to fit instead of being stretched into a distortion.
                const scale = Math.min(width / size.width, height / size.height);
                const w = size.width * scale;
                const h = size.height * scale;
                target.drawPage(embedded, {
                    x: (width - w) / 2,
                    y: (height - h) / 2,
                    width: w,
                    height: h,
                    opacity,
                });
            };

            if (mode === 'under') {
                await drawLayer(page);
                page.drawPage(await embedBase(i), { x: 0, y: 0, width, height });
            } else {
                page.drawPage(await embedBase(i), { x: 0, y: 0, width, height });
                await drawLayer(page);
            }
        }

        out.setProducer('MusePDF');
        out.setCreator(`MusePDF — ${mode === 'under' ? 'underlay' : 'overlay'}`);
        const stem = String(baseFile.name).replace(/\.pdf$/i, '');
        const name = `${stem}-${mode === 'under' ? 'underlay' : 'overlay'}.pdf`;
        const bytes = await out.save();
        const outBlob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
        downloadFile(outBlob, name);

        const result = document.getElementById('overlay-result');
        if (result) {
            const parts = [
                `${basePages.length} page(s): “${layerFile.name}” ${mode === 'under' ? 'under' : 'over'} “${baseFile.name}”`,
                `opacity ${Math.round(opacity * 100)}%`,
            ];
            if (repeated) parts.push(`last page repeated ${repeated}×`);
            if (skipped) parts.push(`${skipped} page(s) left unlayered`);
            // Never rely on the automatic download alone: when the browser blocks it (or the user dismissed the
            // prompt) the result area used to look like nothing happened. A real link always works.
            result.textContent = '';
            const summary = document.createElement('p');
            summary.textContent = `${parts.join(' · ')}.`;
            const link = document.createElement('a');
            link.href = URL.createObjectURL(outBlob);
            link.download = name;
            link.textContent = `${name} (${(outBlob.size / 1024).toFixed(0)} KB) — click to download again`;
            link.style.display = 'block';
            link.style.marginTop = '6px';
            result.append(summary, link);
        }
    } catch (error) {
        console.error('overlay-pdf:', error);
        showAlert('Overlay Error', 'Could not combine these two PDFs. One of them may be damaged or use an unsupported page structure.');
    } finally {
        hideLoader();
    }
}
