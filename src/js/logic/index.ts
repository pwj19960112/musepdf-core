import { merge, setupMergeTool } from './merge.js';
import { setupSplitTool, split } from './split.js';
import { encrypt } from './encrypt.js';
import { decrypt } from './decrypt.js';
import { organize } from './organize.js';
import { rotate } from './rotate.js';
import { addPageNumbers } from './add-page-numbers.js';
import { pdfToJpg } from './pdf-to-jpg.js';
import { jpgToPdf } from './jpg-to-pdf.js';
import { scanToPdf } from './scan-to-pdf.js';
import { compress } from './compress.js';
import { pdfToGreyscale } from './pdf-to-greyscale.js';
import { pdfToZip } from './pdf-to-zip.js';
import { editMetadata } from './edit-metadata.js';
import { removeMetadata } from './remove-metadata.js';
import { pdfToPng } from './pdf-to-png.js';
import { pngToPdf } from './png-to-pdf.js';
import { pdfToWebp } from './pdf-to-webp.js';
import { webpToPdf } from './webp-to-pdf.js';
import { deletePages } from './delete-pages.js';
import { addBlankPage } from './add-blank-page.js';
import { extractPages } from './extract-pages.js';
import { addWatermark, setupWatermarkUI } from './add-watermark.js';
import { addHeaderFooter } from './add-header-footer.js';
import { imageToPdf } from './image-to-pdf.js';
import { pdfToMarkdown } from './pdf-to-markdown.js';
import { pdfToWord } from './pdf-to-word.js';
import { pdfToText } from './pdf-to-text.js';
import { extractImages } from './extract-images.js';
import { pdfToCsv } from './pdf-to-csv.js';
import { pdfToExcel } from './pdf-to-excel.js';
import { txtToPdf } from './txt-to-pdf.js';
import { invertColors } from './invert-colors.js';
// import { viewMetadata } from './view-metadata.js';
import { reversePages } from './reverse-pages.js';
import { mdToPdf } from './md-to-pdf.js';
import { svgToPdf } from './svg-to-pdf.js';
import { bmpToPdf } from './bmp-to-pdf.js';
import { heicToPdf } from './heic-to-pdf.js';
import { tiffToPdf } from './tiff-to-pdf.js';
import { pdfToBmp } from './pdf-to-bmp.js';
import { pdfToTiff } from './pdf-to-tiff.js';
import { splitInHalf } from './split-in-half.js';
import { analyzeAndDisplayDimensions } from './page-dimensions.js';
import { nUpTool, setupNUpUI } from './n-up.js';
import { processAndSave } from './duplicate-organize.js';
import { combineToSinglePage } from './combine-single-page.js';
import { fixDimensions, setupFixDimensionsUI } from './fix-dimensions.js';
import { changeBackgroundColor } from './change-background-color.js';
import { changeTextColor, setupTextColorTool } from './change-text-color.js';
import { wordToPdf } from './word-to-pdf.js';
import { removeAnnotations, setupRemoveAnnotationsTool } from './remove-annotations.js';
import { setupCropperTool } from './cropper.js';
import { posterize, setupPosterizeTool } from './posterize.js';
import { removeBlankPages, setupRemoveBlankPagesTool } from './remove-blank-pages.js';
import { alternateMerge, setupAlternateMergeTool } from './alternate-merge.js';
import { splitBySize, setupSplitBySize } from './split-by-size.js';
import { splitByBookmarks, setupSplitByBookmarks } from './split-by-bookmarks.js';
import { overlayPdf, setupOverlay } from './overlay.js';
import { addAttachments, setupAddAttachments } from './add-attachments.js';
import { bookletPdf, setupBooklet } from './pdf-booklet.js';

export const toolLogic = {
    merge: { process: merge, setup: setupMergeTool },
    split: { process: split, setup: setupSplitTool },
    encrypt,
    decrypt,
    organize,
    rotate,
    'add-page-numbers': addPageNumbers,
    'pdf-to-jpg': pdfToJpg,
    'jpg-to-pdf': jpgToPdf,
    'scan-to-pdf': scanToPdf,
    compress,
    'pdf-to-greyscale': pdfToGreyscale,
    'pdf-to-zip': pdfToZip,
    'edit-metadata': editMetadata,
    'remove-metadata': removeMetadata,
    'pdf-to-png': pdfToPng,
    'png-to-pdf': pngToPdf,
    'pdf-to-webp': pdfToWebp,
    'webp-to-pdf': webpToPdf,
    'delete-pages': deletePages,
    'add-blank-page': addBlankPage,
    'extract-pages': extractPages,
    'add-watermark': { process: addWatermark, setup: setupWatermarkUI },
    'add-header-footer': addHeaderFooter,
    'image-to-pdf': imageToPdf,
    'pdf-to-markdown': pdfToMarkdown,
    'pdf-to-word': pdfToWord,
    'pdf-to-text': pdfToText,
    'extract-images': extractImages,
    'pdf-to-csv': pdfToCsv,
    'pdf-to-excel': pdfToExcel,
    'txt-to-pdf': txtToPdf,
    'invert-colors': invertColors,
    'reverse-pages': reversePages,
    'md-to-pdf': mdToPdf,
    'svg-to-pdf': svgToPdf,
    'bmp-to-pdf': bmpToPdf,
    'heic-to-pdf': heicToPdf,
    'tiff-to-pdf': tiffToPdf,
    'pdf-to-bmp': pdfToBmp,
    'pdf-to-tiff': pdfToTiff,
    'split-in-half': splitInHalf,
    'split-pdf-by-size': { process: splitBySize, setup: setupSplitBySize },
    'split-pdf-by-bookmarks': { process: splitByBookmarks, setup: setupSplitByBookmarks },
    'overlay-pdf': { process: overlayPdf, setup: setupOverlay },
    'add-attachments': { process: addAttachments, setup: setupAddAttachments },
    'pdf-booklet': { process: bookletPdf, setup: setupBooklet },
    'n-up': { process: nUpTool, setup: setupNUpUI },
    'duplicate-organize': { process: processAndSave },
    'combine-single-page': combineToSinglePage,
    'fix-dimensions': { process: fixDimensions, setup: setupFixDimensionsUI },
    'change-background-color': changeBackgroundColor,
    'change-text-color': { process: changeTextColor, setup: setupTextColorTool },
    'word-to-pdf': wordToPdf,
    'remove-annotations': { process: removeAnnotations, setup: setupRemoveAnnotationsTool },
    'cropper': { setup: setupCropperTool },
    'posterize': { process: posterize, setup: setupPosterizeTool },
    'remove-blank-pages': { process: removeBlankPages, setup: setupRemoveBlankPagesTool },
    'alternate-merge': { process: alternateMerge, setup: setupAlternateMergeTool },
};