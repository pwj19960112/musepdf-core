/**
 * Strings the site composes at runtime rather than emitting in the generated HTML (homepage drop
 * chips, the editor hand-off note). They are translated through the same dictionary as the rest of the
 * page, keyed by these English templates, so the generator never sees them — `src/tests/i18n.test.ts`
 * asserts every one of them still has a Chinese entry in seo/i18n.zh.json.
 *
 * Placeholders are `{name}`, `{n}` and `{label}`; callers substitute after translation so word order
 * stays the target language's.
 *
 * The alert/loader entries are the browsing-path messages (ui.ts routes `showAlert`/`showLoader`
 * through `tr`). A per-tool progress message that is not listed here falls through in English.
 */
export const RUNTIME_STRINGS = {
    openingEditor: 'Opening the PDF editor with “{name}” — this tool does not upload.',
    editorUnavailable: 'Could not open “{name}” in the editor in this browser.',
    manyFiles: '{n} files selected — pick a tool that accepts several files.',
    oneFile: '{label} — pick the tool you need. Nothing has been uploaded for this tool.',
    labelPdf: 'PDF detected',
    labelImage: 'Image detected',
    labelWord: 'Word document detected',
    labelText: 'Text file detected',
    labelFile: 'File detected',
    openingTool: 'Opening “{name}” with {tool} — nothing is uploaded.',
    unsupportedTitle: '“{name}” cannot be turned into a PDF in the browser yet.',
    unsupportedBody: 'Export it to PDF first (in Excel or PowerPoint: File → Export → PDF), then drop the PDF here. Or start from another tool:',
    linkAllTools: 'All {n} tools',
    alertError: 'Error',
    alertSuccess: 'Success',
    pdfNotLoaded: 'PDF not loaded.',
    pdfCorrupted: 'An error occurred. The PDF might be corrupted.',
    selectAFile: 'Please select a file.',
    preparing: 'Preparing to process...',
    loadingDocuments: 'Loading PDF documents...',
    renderingPreviews: 'Rendering page previews...',
    // The tiered file-size guard (src/js/fileGuard.ts + src/js/fileGuardUi.ts). Placeholders: `{name}`
    // (file name) and `{size}` (megabytes, one decimal). `notice` is non-blocking; `warn` must be
    // explicitly confirmed; `block` refuses the file outright.
    guardNoticeLine: 'This file is {size} MB — larger than usual. Processing will be slow.',
    guardWarnTitle: 'Large file — continue?',
    guardWarnBody: '“{name}” is {size} MB. A file this large can use a lot of memory and may crash the browser tab. Split or compress it first if you can.',
    guardWarnConfirm: 'Continue anyway',
    guardWarnCancel: 'Cancel',
    guardBlockTitle: 'File too large to process',
    guardBlockBody: '“{name}” is {size} MB, which is too large to process safely in the browser. Please split or compress it first, then try again.',
    guardBlockClose: 'Close',
} as const;
