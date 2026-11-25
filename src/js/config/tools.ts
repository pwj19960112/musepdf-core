// This file centralizes the definition of all available tools, organized by category.
export const categories = [
        {
        name: 'Popular Tools',
        tools: [
            { id: 'merge', name: 'Merge PDF', icon: 'combine', subtitle: 'Combine multiple PDFs into one file.' },
            { id: 'split', name: 'Split PDF', icon: 'scissors', subtitle: 'Extract a range of pages into a new PDF.' },
            { id: 'compress', name: 'Compress PDF', icon: 'zap', subtitle: 'Reduce the file size of your PDF.' },
            { id: 'jpg-to-pdf', name: 'JPG to PDF', icon: 'image-up', subtitle: 'Create a PDF from one or more JPG images.' },
            { id: 'cropper', name: 'Crop PDF', icon: 'crop', subtitle: 'Trim the margins of every page in your PDF.' },
            { id: 'extract-pages', name: 'Extract Pages', icon: 'ungroup', subtitle: 'Save a selection of pages as new files.' },
            { id: 'duplicate-organize', name: 'Duplicate & Organize', icon: 'files', subtitle: 'Duplicate, reorder, and delete pages.' },
            { id: 'delete-pages', name: 'Delete Pages', icon: 'trash-2', subtitle: 'Remove specific pages from your document.' },
        ]
    },
    {
        name: 'Edit & Annotate',
        tools: [
            // { id: 'crop', name: 'Crop PDF', icon: 'crop', subtitle: 'Trim the margins of every page in your PDF.' },
            { id: 'add-page-numbers', name: 'Page Numbers', icon: 'list-ordered', subtitle: 'Insert page numbers into your document.' },
            { id: 'add-watermark', name: 'Add Watermark', icon: 'droplets', subtitle: 'Stamp text or an image over your PDF pages.' },
            { id: 'add-header-footer', name: 'Header & Footer', icon: 'pilcrow', subtitle: 'Add text to the top and bottom of pages.' },
            { id: 'invert-colors', name: 'Invert Colors', icon: 'contrast', subtitle: 'Create a "dark mode" version of your PDF.' },
            { id: 'change-background-color', name: 'Background Color', icon: 'palette', subtitle: 'Change the background color of your PDF.' },
            { id: 'change-text-color', name: 'Change Text Color', icon: 'type', subtitle: 'Change the color of text in your PDF.' },
            { id: 'remove-annotations', name: 'Remove Annotations', icon: 'eraser', subtitle: 'Strip comments, highlights, and links.' },
            { id: 'cropper', name: 'Crop PDF', icon: 'crop', subtitle: 'Trim the margins of every page in your PDF.' },
            { id: 'remove-blank-pages', name: 'Remove Blank Pages', icon: 'file-minus-2', subtitle: 'Automatically detect and delete blank pages.' },
        ]
    },
    {
        name: 'Convert to PDF',
        tools: [
            { id: 'image-to-pdf', name: 'Image to PDF', icon: 'images', subtitle: 'Combine various images into one PDF.' },
            { id: 'jpg-to-pdf', name: 'JPG to PDF', icon: 'image-up', subtitle: 'Create a PDF from one or more JPG images.' },
            { id: 'png-to-pdf', name: 'PNG to PDF', icon: 'image-up', subtitle: 'Create a PDF from one or more PNG images.' },
            { id: 'webp-to-pdf', name: 'WebP to PDF', icon: 'image-up', subtitle: 'Create a PDF from one or more WebP images.' },
            { id: 'svg-to-pdf', name: 'SVG to PDF', icon: 'pen-tool', subtitle: 'Create a PDF from one or more SVG images.' },
            { id: 'bmp-to-pdf', name: 'BMP to PDF', icon: 'image', subtitle: 'Create a PDF from one or more BMP images.' },
            { id: 'heic-to-pdf', name: 'HEIC to PDF', icon: 'smartphone', subtitle: 'Create a PDF from one or more HEIC images.' },
            { id: 'tiff-to-pdf', name: 'TIFF to PDF', icon: 'layers', subtitle: 'Create a PDF from one or more TIFF images.' },
            { id: 'txt-to-pdf', name: 'Text to PDF', icon: 'file-pen', subtitle: 'Convert a plain text file into a PDF.' },
            // { id: 'md-to-pdf', name: 'Markdown to PDF', icon: 'file-text', subtitle: 'Convert a Markdown file into a PDF.' },
            // { id: 'scan-to-pdf', name: 'Scan to PDF', icon: 'camera', subtitle: 'Use your camera to create a scanned PDF.' },
            // { id: 'word-to-pdf', name: 'Word to PDF', icon: 'file-text', subtitle: 'Convert .docx documents to PDF.' },
        ]
    },
    {
        name: 'Convert from PDF',
        tools: [
            { id: 'pdf-to-jpg', name: 'PDF to JPG', icon: 'file-image', subtitle: 'Convert each PDF page into a JPG image.' },
            { id: 'pdf-to-png', name: 'PDF to PNG', icon: 'file-image', subtitle: 'Convert each PDF page into a PNG image.' },
            { id: 'pdf-to-webp', name: 'PDF to WebP', icon: 'file-image', subtitle: 'Convert each PDF page into a WebP image.' },
            { id: 'pdf-to-bmp', name: 'PDF to BMP', icon: 'file-image', subtitle: 'Convert each PDF page into a BMP image.' },
            { id: 'pdf-to-tiff', name: 'PDF to TIFF', icon: 'file-image', subtitle: 'Convert each PDF page into a TIFF image.' },
            { id: 'pdf-to-greyscale', name: 'PDF to Greyscale', icon: 'palette', subtitle: 'Convert all colors to black and white.' },
            { id: 'pdf-to-word', name: 'PDF to Word', icon: 'file-text', subtitle: 'Extract the text of a PDF into an editable .docx document.' },
            { id: 'pdf-to-text', name: 'PDF to Text', icon: 'file-type', subtitle: 'Extract the text layer of a PDF into a plain .txt file.' },
            { id: 'pdf-to-csv', name: 'PDF to CSV', icon: 'table', subtitle: 'Rebuild the tables in a PDF as CSV files, one per page.' },
            { id: 'pdf-to-excel', name: 'PDF to Excel', icon: 'file-spreadsheet', subtitle: 'Turn PDF tables into a real .xlsx workbook, one sheet per page.' },
            { id: 'extract-images', name: 'Extract Images', icon: 'images', subtitle: 'Pull every embedded image out of a PDF into a ZIP.' },
            // { id: 'pdf-to-markdown', name: 'PDF to Markdown', icon: 'file-pen', subtitle: 'Extract text into a Markdown file.' },
        ]
    },
    {
        name: 'Organize & Manage',
        tools: [
            { id: 'merge', name: 'Merge PDF', icon: 'combine', subtitle: 'Combine multiple PDFs into one file.' },
            { id: 'alternate-merge', name: 'Alternate & Mix Pages', icon: 'shuffle', subtitle: 'Combine PDFs by alternating pages from each.' },
            { id: 'organize', name: 'Organize PDF', icon: 'grip', subtitle: 'Reorder pages by dragging and dropping.' },
            { id: 'duplicate-organize', name: 'Duplicate & Organize', icon: 'files', subtitle: 'Duplicate, reorder, and delete pages.' },
            { id: 'split', name: 'Split PDF', icon: 'scissors', subtitle: 'Extract a range of pages into a new PDF.' },
            { id: 'split-in-half', name: 'Divide Pages', icon: 'table-columns-split', subtitle: 'Divide pages horizontally or vertically.' },
            { id: 'split-pdf-by-size', name: 'Split by Size', icon: 'weight', subtitle: 'Cut a PDF into parts that each fit under a size limit.' },
            { id: 'split-pdf-by-bookmarks', name: 'Split by Bookmarks', icon: 'book-marked', subtitle: 'One file per chapter or section, taken straight from the PDF outline.' },
            { id: 'extract-pages', name: 'Extract Pages', icon: 'ungroup', subtitle: 'Save a selection of pages as new files.' },
            { id: 'delete-pages', name: 'Delete Pages', icon: 'trash-2', subtitle: 'Remove specific pages from your document.' },
            { id: 'add-blank-page', name: 'Add Blank Page', icon: 'file-plus-2', subtitle: 'Insert an empty page anywhere in your PDF.' },
            { id: 'reverse-pages', name: 'Reverse Pages', icon: 'arrow-down-z-a', subtitle: 'Flip the order of all pages in your document.' },
            { id: 'rotate', name: 'Rotate PDF', icon: 'rotate-cw', subtitle: 'Turn pages in 90-degree increments.' },
            { id: 'n-up', name: 'N-Up PDF', icon: 'layout-grid', subtitle: 'Arrange multiple pages onto a single sheet.' },
            { id: 'combine-single-page', name: 'Combine to Single Page', icon: 'unfold-vertical', subtitle: 'Stitch all pages into one continuous scroll.' },
            { id: 'view-metadata', name: 'View Metadata', icon: 'info', subtitle: 'Inspect the hidden properties of your PDF.' },
            { id: 'edit-metadata', name: 'Edit Metadata', icon: 'file-cog', subtitle: 'Change the author, title, and other properties.' },
            { id: 'pdf-to-zip', name: 'PDFs to ZIP', icon: 'stretch-horizontal', subtitle: 'Package multiple PDF files into a ZIP archive.' },
            { id: 'overlay-pdf', name: 'Overlay PDF', icon: 'layers', subtitle: 'Lay one PDF over or under another — letterheads, watermarks, pre-printed forms.' },
            { id: 'add-attachments', name: 'Add Attachments', icon: 'paperclip', subtitle: 'Embed invoices, source files or supporting documents inside the PDF.' },
            { id: 'pdf-booklet', name: 'PDF Booklet', icon: 'book-open', subtitle: 'Impose pages for saddle-stitch printing: fold, staple, read.' },
            { id: 'posterize', name: 'Posterize PDF', icon: 'layout-grid', subtitle: 'Split a large page into multiple smaller pages.' },
        ]
    },
    {
        name: 'Optimize & Repair',
        tools: [
            { id: 'compress', name: 'Compress PDF', icon: 'zap', subtitle: 'Reduce the file size of your PDF.' },
            { id: 'fix-dimensions', name: 'Fix Page Size', icon: 'ruler-dimension-line', subtitle: 'Standardize all pages to a uniform size.' },
        ]
    },
    {
        name: 'Secure PDF',
        tools: [
            { id: 'encrypt', name: 'Encrypt PDF', icon: 'lock', subtitle: 'Add a password to protect your PDF.' },
            { id: 'decrypt', name: 'Decrypt PDF', icon: 'unlock', subtitle: 'Remove password protection from a PDF.' },
            { id: 'remove-metadata', name: 'Remove Metadata', icon: 'file-x', subtitle: 'Strip hidden data from your PDF.' },
        ]
    }, 
];