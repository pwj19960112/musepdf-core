import { showLoader, hideLoader, showAlert } from '../ui.js';
import { downloadFile, readFileAsArrayBuffer } from '../utils/helpers.js';
import { state } from '../state.js';
import JSZip from 'jszip';
import * as pdfjsLib from 'pdfjs-dist';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const escapeXml = (value: string): string => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/** One <w:p> per paragraph; Word wraps long lines itself. */
function buildDocumentXml(paragraphs: string[]): string {
    const body = paragraphs
        .map((text) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`)
        .join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body>
</w:document>`;
}

async function buildDocx(paragraphs: string[]): Promise<Blob> {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', CONTENT_TYPES);
    zip.folder('_rels')?.file('.rels', ROOT_RELS);
    zip.folder('word')?.file('document.xml', buildDocumentXml(paragraphs));
    return zip.generateAsync({
        type: 'blob',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
}

/**
 * PDF to Word: extracts the text layer of a PDF and writes a real .docx (OOXML) file locally.
 * Text-only by design — images, tables and the original layout are not reproduced — and nothing
 * is uploaded; pdf.js runs in the page.
 */
export async function pdfToWord() {
    showLoader('Converting to Word...');
    try {
        const file = state.files[0];
        const arrayBuffer = await readFileAsArrayBuffer(file);
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer as ArrayBuffer }).promise;
        const paragraphs: string[] = [];

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            let current = '';
            for (const item of content.items as any[]) {
                if (typeof item.str !== 'string') continue;
                current += item.str;
                if (item.hasEOL) {
                    const line = current.replace(/\s+$/, '');
                    if (line.trim()) paragraphs.push(line);
                    current = '';
                } else {
                    current += ' ';
                }
            }
            if (current.trim()) paragraphs.push(current.trim());
            if (paragraphs.length) paragraphs.push(''); // page break as an empty paragraph
        }

        while (paragraphs.length && paragraphs[paragraphs.length - 1] === '') paragraphs.pop();

        if (!paragraphs.length) {
            showAlert('No text found', 'This PDF has no text layer — it looks like a scan. Use OCR PDF first, then convert.');
            return;
        }

        const blob = await buildDocx(paragraphs);
        downloadFile(blob, file.name.replace(/\.pdf$/i, '.docx'));
    } catch (error) {
        console.error(error);
        showAlert('Conversion Error', 'Failed to convert this PDF. It may be image-based, encrypted or corrupted.');
    } finally {
        hideLoader();
    }
}
