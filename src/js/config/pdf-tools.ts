export const singlePdfLoadTools = [
  'split', 'organize', 'rotate', 'add-page-numbers',
  'pdf-to-jpg', 'pdf-to-png', 'pdf-to-webp', 'compress', 'pdf-to-greyscale',
  'edit-metadata', 'remove-metadata', 'delete-pages', 'add-blank-page',
  'extract-pages', 'add-watermark', 'add-header-footer', 'invert-colors', 'view-metadata',
  'reverse-pages', 'crop', 'redact', 'pdf-to-bmp', 'pdf-to-tiff', 'split-in-half',
  // 'page-dimensions' is deliberately absent: /pdf-page-dimensions/ is a workbench entry now
  // (Route A), and fileHandler's workbench branch is the last `else if` in its chain, so a
  // membership here would let the single-PDF branch below swallow it and the editor would never mount.
  // 'sign-pdf' is absent for the same reason: the workbench's signature mode replaced our own
  // single-PDF signer, so /sign-pdf/ now routes to the workbench.
  // 'annotate' (/annotate-pdf/) and 'stamp' (/stamp-pdf/) are workbench entries too (Route A) and
  // may NEVER be listed here (or in simpleTools / multiFileTools): the earlier `else if` would
  // swallow them, exactly as it once hid /edit-pdf/ and /pdf-page-dimensions/, and the workbench
  // would never mount. src/tests/pdf-tools.test.ts asserts that these ids stay out of every load list.
  // 'edit-bookmarks' reads and rewrites the outline with pdf-lib, so it wants the loaded document
  // (and the encryption check) that this list provides — it is not a `simpleTools` entry.
  // Table of Contents reads the outline and inserts pages; Add Page Labels writes a number tree on the
  // catalog. Both need the pdf-lib document, so they take this path rather than reading the file again.
  'n-up', 'duplicate-organize', 'combine-single-page', 'fix-dimensions', 'change-background-color',
  'change-text-color', 'remove-annotations', 'cropper', 'posterize', 'remove-blank-pages',
  // Phase 3: all four read or rewrite the loaded pdf-lib document (page ranges, the outline, the page
  // tree, the /Names tree), so they take this path — the one that loads the document and the
  // encryption check — rather than `simpleTools`.
  'split-pdf-by-size',
  'split-pdf-by-bookmarks',
  'add-attachments',
  'pdf-booklet',];

export const simpleTools = [
  'encrypt', 'decrypt', 'pdf-to-markdown', 'word-to-pdf', 'pdf-to-word',
  // Text-side converters: they read the PDF with pdf.js in their own module, so they need no
  // pdf-lib preload and no page thumbnails — the `simpleTools` branch just reveals the options.
  // 'pdf-to-csv' and 'pdf-to-excel' are the same shape: they rebuild tables from the text layer, and
  // their output is a CSV/ZIP or an XLSX built in the browser, so no document has to be preloaded.
  'pdf-to-text', 'extract-images', 'pdf-to-csv', 'pdf-to-excel',
];

export const multiFileTools = [
  'merge', 'pdf-to-zip', 'jpg-to-pdf', 'png-to-pdf', 'webp-to-pdf', 'image-to-pdf', 'svg-to-pdf', 'bmp-to-pdf', 'heic-to-pdf', 'tiff-to-pdf',
  'alternate-merge',
  // Bates numbering runs one continuous counter across every selected file, so it is a multi-file tool.
  // Overlay needs TWO documents and the order matters (base first, layer second), so the multi-file
  // path — which keeps the files in the order they were added — is the honest one.,
  'overlay-pdf',
];