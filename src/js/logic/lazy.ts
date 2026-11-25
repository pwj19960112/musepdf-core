/**
 * Per-tool logic loader.
 *
 * `logic/index.ts` imports all 55 tool modules statically, which pulled every heavy dependency
 * (pdf.js, Tesseract, pdfkit, heic2any, UTIF, cropperjs, jsPDF, html2canvas) into one 5 MB chunk that
 * every landing page had to download. This module maps each tool id to a dynamic import instead, so a
 * page pays only for the tool it actually mounts.
 *
 * The returned shape matches the old `toolLogic[id]` entries exactly: either a bare function or an
 * object with `process` / `setup`, because both `toolSelectionHandler` and `fileHandler` accept both.
 */

export type ToolLogic = { process?: () => unknown; setup?: () => unknown } | ((...args: any[]) => unknown);

const cache = new Map<string, ToolLogic | null>();

/**
 * Tools that read pdf.js (directly or through the `pdfjsLib` global). For these, the worker is
 * configured before the tool module runs — see src/js/pdfjs.ts.
 */
const PDFJS_TOOLS = new Set([
    'merge', 'split', 'compress', 'cropper', 'crop', 'decrypt', 'encrypt', 'change-permissions',
    'form-filler', 'pdf-to-tiff', 'pdf-to-word', 'posterize', 'remove-blank-pages', 'change-text-color',
    'compare-pdfs', 'invert-colors', 'ocr-pdf', 'pdf-to-bmp', 'pdf-to-greyscale', 'pdf-to-jpg',
    'pdf-to-markdown', 'pdf-to-png', 'pdf-to-webp', 'sign-pdf', 'duplicate-organize',
    'organize', 'rotate', 'extract-pages', 'delete-pages', 'add-page-numbers', 'add-blank-page',
    'add-header-footer', 'add-watermark', 'page-dimensions', 'n-up', 'remove-annotations',
    'pdf-to-text', 'extract-images', 'pdf-to-csv', 'pdf-to-excel',
]);

/** Load (once) and cache the logic for a tool id. Both the selection handler and the file handler use this. */
export async function getToolLogic(id: string): Promise<ToolLogic | null> {
    if (PDFJS_TOOLS.has(id)) {
        const { ensurePdfjs } = await import('../pdfjs.js');
        await ensurePdfjs();
    }
    if (cache.has(id)) return cache.get(id) ?? null;
    const logic = await loadToolLogic(id);
    cache.set(id, logic);
    return logic;
}

export async function loadToolLogic(id: string): Promise<ToolLogic | null> {
    switch (id) {
        case 'merge': {
            const m = await import('./merge.js');
            return { process: m.merge, setup: m.setupMergeTool };
        }
        case 'split': {
            const m = await import('./split.js');
            return { process: m.split, setup: m.setupSplitTool };
        }
        case 'encrypt': return (await import('./encrypt.js')).encrypt;
        case 'decrypt': return (await import('./decrypt.js')).decrypt;
        case 'organize': return (await import('./organize.js')).organize;
        case 'rotate': return (await import('./rotate.js')).rotate;
        case 'add-page-numbers': return (await import('./add-page-numbers.js')).addPageNumbers;
        case 'pdf-to-jpg': return (await import('./pdf-to-jpg.js')).pdfToJpg;
        case 'jpg-to-pdf': return (await import('./jpg-to-pdf.js')).jpgToPdf;
        case 'scan-to-pdf': return (await import('./scan-to-pdf.js')).scanToPdf;
        case 'compress': return (await import('./compress.js')).compress;
        case 'pdf-to-greyscale': return (await import('./pdf-to-greyscale.js')).pdfToGreyscale;
        case 'pdf-to-zip': return (await import('./pdf-to-zip.js')).pdfToZip;
        case 'edit-metadata': return (await import('./edit-metadata.js')).editMetadata;
        case 'remove-metadata': return (await import('./remove-metadata.js')).removeMetadata;
        case 'pdf-to-png': return (await import('./pdf-to-png.js')).pdfToPng;
        case 'png-to-pdf': return (await import('./png-to-pdf.js')).pngToPdf;
        case 'pdf-to-webp': return (await import('./pdf-to-webp.js')).pdfToWebp;
        case 'webp-to-pdf': return (await import('./webp-to-pdf.js')).webpToPdf;
        case 'delete-pages': return (await import('./delete-pages.js')).deletePages;
        case 'add-blank-page': return (await import('./add-blank-page.js')).addBlankPage;
        case 'extract-pages': return (await import('./extract-pages.js')).extractPages;
        case 'add-watermark': {
            const m = await import('./add-watermark.js');
            return { process: m.addWatermark, setup: m.setupWatermarkUI };
        }
        case 'add-header-footer': return (await import('./add-header-footer.js')).addHeaderFooter;
        case 'image-to-pdf': return (await import('./image-to-pdf.js')).imageToPdf;
        case 'pdf-to-markdown': return (await import('./pdf-to-markdown.js')).pdfToMarkdown;
        case 'pdf-to-text': return (await import('./pdf-to-text.js')).pdfToText;
        case 'extract-images': return (await import('./extract-images.js')).extractImages;
        case 'pdf-to-csv': return (await import('./pdf-to-csv.js')).pdfToCsv;
        case 'pdf-to-excel': return (await import('./pdf-to-excel.js')).pdfToExcel;
        case 'pdf-to-word': return (await import('./pdf-to-word.js')).pdfToWord;
        case 'txt-to-pdf': return (await import('./txt-to-pdf.js')).txtToPdf;
        case 'invert-colors': return (await import('./invert-colors.js')).invertColors;
        case 'reverse-pages': return (await import('./reverse-pages.js')).reversePages;
        case 'md-to-pdf': return (await import('./md-to-pdf.js')).mdToPdf;
        case 'svg-to-pdf': return (await import('./svg-to-pdf.js')).svgToPdf;
        case 'bmp-to-pdf': return (await import('./bmp-to-pdf.js')).bmpToPdf;
        case 'heic-to-pdf': return (await import('./heic-to-pdf.js')).heicToPdf;
        case 'tiff-to-pdf': return (await import('./tiff-to-pdf.js')).tiffToPdf;
        case 'pdf-to-bmp': return (await import('./pdf-to-bmp.js')).pdfToBmp;
        case 'pdf-to-tiff': return (await import('./pdf-to-tiff.js')).pdfToTiff;
        case 'split-in-half': return (await import('./split-in-half.js')).splitInHalf;
        // Split by Size measures parts by serialising them with pdf-lib, so it needs the document the
        // single-PDF branch already loaded (`state.pdfDoc`) plus its setup hook for the page/byte note.
        case 'pdf-booklet': {
            const m = await import('./pdf-booklet.js');
            return { process: m.bookletPdf, setup: m.setupBooklet };
        }
        case 'add-attachments': {
            const m = await import('./add-attachments.js');
            return { process: m.addAttachments, setup: m.setupAddAttachments };
        }
        case 'overlay-pdf': {
            const m = await import('./overlay.js');
            return { process: m.overlayPdf, setup: m.setupOverlay };
        }
        case 'split-pdf-by-bookmarks': {
            const m = await import('./split-by-bookmarks.js');
            return { process: m.splitByBookmarks, setup: m.setupSplitByBookmarks };
        }
        case 'split-pdf-by-size': {
            const m = await import('./split-by-size.js');
            return { process: m.splitBySize, setup: m.setupSplitBySize };
        }
        case 'n-up': {
            const m = await import('./n-up.js');
            return { process: m.nUpTool, setup: m.setupNUpUI };
        }
        case 'duplicate-organize': {
            const m = await import('./duplicate-organize.js');
            return { process: m.processAndSave };
        }
        case 'combine-single-page': return (await import('./combine-single-page.js')).combineToSinglePage;
        case 'fix-dimensions': {
            const m = await import('./fix-dimensions.js');
            return { process: m.fixDimensions, setup: m.setupFixDimensionsUI };
        }
        case 'change-background-color': return (await import('./change-background-color.js')).changeBackgroundColor;
        case 'change-text-color': {
            const m = await import('./change-text-color.js');
            return { process: m.changeTextColor, setup: m.setupTextColorTool };
        }
        case 'word-to-pdf': return (await import('./word-to-pdf.js')).wordToPdf;
        case 'remove-annotations': {
            const m = await import('./remove-annotations.js');
            return { process: m.removeAnnotations, setup: m.setupRemoveAnnotationsTool };
        }
        case 'cropper':
        case 'crop': {
            const m = await import('./cropper.js');
            return { setup: m.setupCropperTool };
        }
        case 'posterize': {
            const m = await import('./posterize.js');
            return { process: m.posterize, setup: m.setupPosterizeTool };
        }
        case 'remove-blank-pages': {
            const m = await import('./remove-blank-pages.js');
            return { process: m.removeBlankPages, setup: m.setupRemoveBlankPagesTool };
        }
        case 'alternate-merge': {
            const m = await import('./alternate-merge.js');
            return { process: m.alternateMerge, setup: m.setupAlternateMergeTool };
        }
        default:
            return null;
    }
}
