import { showLoader, hideLoader, showAlert } from '../ui.js';
import { downloadFile, readFileAsArrayBuffer } from '../utils/helpers.js';
import { state } from '../state.js';
import JSZip from 'jszip';

/**
 * Extract images from a PDF.
 *
 * pdf.js resolves every image an operator list references through `page.objs`, so this walks each
 * page's operators, resolves the image objects, paints them onto a canvas and packages the results.
 * No rendering of the page: an image keeps its own resolution, and text/vector art is not captured
 * (that is what PDF to PNG is for).
 *
 * MEMORY IS THE WHOLE PROBLEM HERE. A 200-page catalogue can hold several hundred full-page bitmaps;
 * decoding them all and handing one giant ZIP to the downloader kills the tab long before the file is
 * written. So this module:
 *   - decodes ONE image at a time and releases the pixels immediately (the canvas is not retained);
 *   - skips images smaller than 16 px on either side (icons, rules, spacers — noise in the output);
 *   - skips a single image above 40 megapixels rather than allocating it;
 *   - stops at 300 images or 150 MB of output, and says so instead of dying;
 *   - deduplicates by the object id, so a logo drawn on 50 pages is extracted once.
 * The numbers are constants at the top of the file, and the notice in the page reports what happened.
 */

/** Images smaller than this on either side are decoration, not content. */
const MIN_SIDE = 16;
/** A single image larger than this is refused instead of decoded (40 MP ≈ 160 MB of RGBA). */
const MAX_PIXELS = 40_000_000;
/** Hard stops, reported to the visitor rather than silently truncating. */
const MAX_IMAGES = 300;
const MAX_TOTAL_BYTES = 150 * 1024 * 1024;

/**
 * A content signature for a produced image, so the same picture is only packaged once.
 *
 * `page.objs` ids are PAGE-scoped (`img_p0_1`, `img_p1_1`), so the object-id set alone cannot see
 * that a logo drawn again on page 40 is the same logo — the ids differ. Encoded bytes can: the same
 * pixels go through the same deterministic encoder and come out identical, so an FNV-1a over the
 * bytes plus the length is a stable fingerprint.
 */
function signature(bytes: Uint8Array): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
        hash ^= bytes[i];
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `${bytes.length}:${hash.toString(16)}`;
}

export type ExtractedImage = { page: number; index: number; width: number; height: number; blob: Blob; ext: string };

/** `p3-img2.png` — page first, so the archive sorts in reading order. */
export function imageFileName(page: number, index: number, ext: string): string {
    return `p${String(page).padStart(2, '0')}-img${String(index).padStart(2, '0')}.${ext}`;
}

/** True when an image is too small to be worth extracting, or too big to decode safely. */
export function isUsableImage(width: number, height: number): boolean {
    if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
    if (width < MIN_SIDE || height < MIN_SIDE) return false;
    if (width * height > MAX_PIXELS) return false;
    return true;
}

/**
 * Paint one pdf.js image object onto a canvas. Three shapes arrive here:
 *   - an ImageBitmap (JPEG images with a native decoder);
 *   - `{ kind, data }` where kind is pdf.js's ImageKind (1 = 1-bit gray, 2 = RGB, 3 = RGBA);
 *   - `{ bitmap }` on newer pdf.js versions for the same JPEG case.
 */
function imageToCanvas(img: any): HTMLCanvasElement | null {
    const width = img?.width | 0;
    const height = img?.height | 0;
    if (!isUsableImage(width, height)) return null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const isBitmap = (value: any) => typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap;
    const source = isBitmap(img.bitmap) ? img.bitmap : isBitmap(img.data) ? img.data : isBitmap(img) ? img : null;
    if (source) {
        ctx.drawImage(source as CanvasImageSource, 0, 0, width, height);
        return canvas;
    }

    const data = img.data;
    if (!data || !data.length) return null;
    const pixels = ctx.createImageData(width, height);
    const out = pixels.data;

    if (img.kind === 3 || data.length === width * height * 4) {
        out.set(data.length === out.length ? data : data.subarray(0, out.length));
    } else if (img.kind === 2 || data.length === width * height * 3) {
        for (let i = 0, j = 0; i < out.length; i += 4, j += 3) {
            out[i] = data[j];
            out[i + 1] = data[j + 1];
            out[i + 2] = data[j + 2];
            out[i + 3] = 255;
        }
    } else {
        // 1 bit per pixel, rows padded to whole bytes: 0 is black, 1 is white.
        const rowBytes = (width + 7) >> 3;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
                const v = bit ? 255 : 0;
                const i = (y * width + x) * 4;
                out[i] = v;
                out[i + 1] = v;
                out[i + 2] = v;
                out[i + 3] = 255;
            }
        }
    }

    ctx.putImageData(pixels, 0, 0);
    return canvas;
}

/** White behind a JPEG: without it every transparent pixel comes out black. */
function flatten(canvas: HTMLCanvasElement): HTMLCanvasElement {
    const flat = document.createElement('canvas');
    flat.width = canvas.width;
    flat.height = canvas.height;
    const ctx = flat.getContext('2d');
    if (!ctx) return canvas;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, flat.width, flat.height);
    ctx.drawImage(canvas, 0, 0);
    return flat;
}

function canvasToBlob(canvas: HTMLCanvasElement, format: 'png' | 'jpeg'): Promise<Blob | null> {
    return new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob), format === 'jpeg' ? 'image/jpeg' : 'image/png', 0.92);
    });
}

/**
 * Resolve one image object from a page.
 *
 * pdf.js only DECODES an image when something paints it — `getOperatorList()` alone gives you the
 * names, and `page.objs.get(name, cb)` then waits forever because the callback is never called. So
 * `decodePage()` below renders the page first; after that the object is in `page.objs` (or, for a
 * shared/global image, `page.commonObjs`) and this is a plain lookup.
 */
function resolveObject(page: any, id: string): any {
    try {
        if (page.objs.has(id)) return page.objs.get(id);
        if (page.commonObjs.has(id)) return page.commonObjs.get(id);
    } catch {
        /* fall through: an object that will not resolve is skipped, not fatal */
    }
    return null;
}

/**
 * Force pdf.js to decode the page's images and return the scratch canvas.
 *
 * The render target is deliberately tiny (max 240 px on the long side): the bitmap handed back in
 * `page.objs` keeps the image's NATIVE dimensions regardless of the canvas size, so this costs one
 * small canvas per page instead of a full-resolution one, and no pixel data is wasted on the page
 * rendering itself.
 */
async function decodePage(page: any, scratch: HTMLCanvasElement): Promise<void> {
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(0.25, 240 / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    scratch.width = Math.max(1, Math.ceil(viewport.width));
    scratch.height = Math.max(1, Math.ceil(viewport.height));
    const ctx = scratch.getContext('2d');
    if (!ctx) return;
    await page.render({ canvasContext: ctx, viewport, canvas: scratch }).promise;
}

export async function extractImages(): Promise<void> {
    const file = state.files[0];
    if (!file) {
        showAlert('No file', 'Please select a PDF file first.');
        return;
    }

    const format = ((document.getElementById('extract-images-format') as HTMLSelectElement | null)?.value === 'jpeg' ? 'jpeg' : 'png');
    const ext = format === 'jpeg' ? 'jpg' : 'png';
    const notice = document.getElementById('extract-images-notice');

    showLoader('Extracting images...');
    try {
        const pdfjsLib = await import('pdfjs-dist');
        const OPS = pdfjsLib.OPS;
        const arrayBuffer = await readFileAsArrayBuffer(file);
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer as ArrayBuffer }).promise;

        const seen = new Set<string>();
        const signatures = new Set<string>();
        const images: ExtractedImage[] = [];
        const scratch = document.createElement('canvas');
        let totalBytes = 0;
        let skipped = 0;
        let capped = false;

        for (let pageNumber = 1; pageNumber <= pdf.numPages && !capped; pageNumber++) {
            const page = await pdf.getPage(pageNumber);
            const ops = await page.getOperatorList();
            const candidates: Array<{ id?: string; inline?: any }> = [];

            for (let i = 0; i < ops.fnArray.length; i++) {
                const fn = ops.fnArray[i];
                const args = ops.argsArray[i];
                if (fn === OPS.paintImageXObject || fn === OPS.paintImageMaskXObject) {
                    const name = args?.[0];
                    if (typeof name === 'string') candidates.push({ id: name });
                    else if (name && typeof name === 'object') candidates.push({ inline: name });
                } else if (fn === OPS.paintInlineImageXObject) {
                    candidates.push({ inline: args?.[0] });
                }
            }

            // Nothing can be extracted from a page whose images were never decoded.
            const pending = candidates.filter((c) => !c.id || !seen.has(c.id));
            if (pending.some((c) => c.id)) await decodePage(page, scratch);

            let index = 0;
            for (const candidate of candidates) {
                if (capped) break;
                if (candidate.id) {
                    if (seen.has(candidate.id)) continue;
                    seen.add(candidate.id);
                }
                const raw = candidate.id ? resolveObject(page, candidate.id) : candidate.inline;
                if (!raw) {
                    skipped++;
                    continue;
                }
                const canvas = imageToCanvas(raw);
                if (!canvas) {
                    skipped++;
                    continue;
                }
                const blob = await canvasToBlob(format === 'jpeg' ? flatten(canvas) : canvas, format);
                // Release the pixels before the next image: canvas memory is the peak here.
                canvas.width = 0;
                canvas.height = 0;
                if (!blob) {
                    skipped++;
                    continue;
                }
                const fingerprint = signature(new Uint8Array(await blob.arrayBuffer()));
                if (signatures.has(fingerprint)) continue;
                signatures.add(fingerprint);
                index++;
                images.push({ page: pageNumber, index, width: raw.width | 0, height: raw.height | 0, blob, ext });
                totalBytes += blob.size;
                if (images.length >= MAX_IMAGES || totalBytes >= MAX_TOTAL_BYTES) capped = true;
            }
            page.cleanup();
        }

        if (!images.length) {
            showAlert(
                'No images found',
                'This PDF has no embedded images to extract — its pages are text or vector art. Use PDF to PNG to turn pages into images instead.'
            );
            return;
        }

        if (notice) {
            const summary = notice.querySelector('[data-image-summary]');
            const limit = notice.querySelector('[data-image-limit]');
            if (summary) {
                summary.textContent = `${images.length} image(s) from ${pdf.numPages} page(s)${skipped ? `, ${skipped} skipped (too small or too large)` : ''}.`;
            }
            if (limit) {
                limit.textContent = capped
                    ? `Stopped at the safety cap (${MAX_IMAGES} images / 150 MB) — the file is partly extracted.`
                    : '';
                limit.classList.toggle('hidden', !capped);
            }
            notice.classList.remove('hidden');
        }

        if (images.length === 1) {
            downloadFile(images[0].blob, imageFileName(images[0].page, images[0].index, images[0].ext));
            return;
        }

        const zip = new JSZip();
        for (const image of images) {
            zip.file(imageFileName(image.page, image.index, image.ext), image.blob);
        }
        const archive = await zip.generateAsync({ type: 'blob' });
        downloadFile(archive, `${String(file.name || 'document').replace(/\.pdf$/i, '')}-images.zip`);
    } catch (error) {
        console.error(error);
        showAlert('Extraction Error', 'Could not extract images from this PDF. It may be encrypted, corrupted or use an unsupported image format.');
    } finally {
        hideLoader();
    }
}
