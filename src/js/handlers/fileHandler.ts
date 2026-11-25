import { state } from '../state.js';
import { showLoader, hideLoader, showAlert, renderPageThumbnails, renderFileDisplay, switchView } from '../ui.js';
import { readFileAsArrayBuffer } from '../utils/helpers.js';
import { getToolLogic } from '../logic/lazy.js';
import { createIcons } from 'lucide';
import { toolIcons as icons } from '../icons/lucide-subset.js';
import { multiFileTools, simpleTools, singlePdfLoadTools } from '../config/pdf-tools.js';

async function handleSinglePdfUpload(toolId, file) {
    showLoader('Loading PDF...');
    try {
        const pdfBytes = await readFileAsArrayBuffer(file);
        // Heavy libraries are imported on demand: a landing page must not download pdf-lib merely to
        // show a file picker. ensurePdfjs() also configures the pdf.js worker and publishes the
        // `pdfjsLib` global that ui.ts and several tool modules rely on.
        const { PDFDocument: PDFLibDocument } = await import('pdf-lib');
        const { ensurePdfjs } = await import('../pdfjs.js');
        await ensurePdfjs();
        state.pdfDoc = await PDFLibDocument.load(pdfBytes as ArrayBuffer, {
            ignoreEncryption: true
        });
        hideLoader();

        if (state.pdfDoc.isEncrypted && toolId !== 'decrypt' && toolId !== 'change-permissions') {
            showAlert('Protected PDF', 'This PDF is password-protected. Please use the Decrypt or Change Permissions tool first.');
            switchView('grid');
            return;
        }

        const optionsDiv = document.querySelector('[id$="-options"], [id$="-preview"], [id$="-organizer"], [id$="-rotator"], [id$="-editor"]');
        if (optionsDiv) optionsDiv.classList.remove('hidden');

        const processBtn = document.getElementById('process-btn');
        if (processBtn) {
            (processBtn as HTMLButtonElement).disabled = false;
            processBtn.classList.remove('hidden');
            const logic = await getToolLogic(toolId);
            if (logic) {
                const func = typeof (logic as any).process === 'function' ? (logic as any).process : logic;
                processBtn.onclick = func;
            }
        }

        if (['split', 'delete-pages', 'add-blank-page', 'extract-pages', 'add-header-footer'].includes(toolId)) {
            document.getElementById('total-pages').textContent = state.pdfDoc.getPageCount().toString();
        }

        if (toolId === 'organize' || toolId === 'rotate') {
            await renderPageThumbnails(toolId, state.pdfDoc);

            if (toolId === 'rotate') {
                const rotateAllControls = document.getElementById('rotate-all-controls');
                const rotateAllLeftBtn = document.getElementById('rotate-all-left-btn');
                const rotateAllRightBtn = document.getElementById('rotate-all-right-btn');

                rotateAllControls.classList.remove('hidden');
                createIcons({ icons });

                const rotateAll = (direction) => {
                    document.querySelectorAll('.page-rotator-item').forEach(item => {
                        const currentRotation = parseInt((item as HTMLElement).dataset.rotation || '0');
                        const newRotation = (currentRotation + (direction * 90) + 360) % 360;
                        (item as HTMLElement).dataset.rotation = newRotation.toString();
                        const thumbnail = item.querySelector('canvas, img');
                        if (thumbnail) {
                            (thumbnail as HTMLElement).style.transform = `rotate(${newRotation}deg)`;
                        }
                    });
                };
                rotateAllLeftBtn.onclick = () => rotateAll(-1);
                rotateAllRightBtn.onclick = () => rotateAll(1);
            }
        }

        if (toolId === 'duplicate-organize') {
            const { renderDuplicateOrganizeThumbnails } = await import('../logic/duplicate-organize.js');
            await renderDuplicateOrganizeThumbnails();
        }
        if (['crop', 'redact'].includes(toolId)) {
            const { setupCanvasEditor } = await import('../canvasEditor.js');
            await setupCanvasEditor(toolId);
        }

        if (toolId === 'view-metadata') {
            const resultsDiv = document.getElementById('metadata-results');
            showLoader('Analyzing full PDF metadata...');

            try {
                const pdfBytes = await readFileAsArrayBuffer(state.files[0]);
                const { ensurePdfjs } = await import('../pdfjs.js');
                const pdfjsLib = await ensurePdfjs();
                const pdfjsDoc = await pdfjsLib.getDocument({ data: pdfBytes as ArrayBuffer }).promise;
                // getFieldObjects() throws for documents without an AcroForm, which is the common case.
                const [metadata, fieldObjects] = await Promise.all([
                    pdfjsDoc.getMetadata(),
                    pdfjsDoc.getFieldObjects().catch(() => null)
                ]);

                const { info, metadata: rawXmpString } = metadata;

                resultsDiv.textContent = ''; // Clear safely

                const createSection = (title) => {
                    const wrapper = document.createElement('div');
                    wrapper.className = 'mb-4';
                    const h3 = document.createElement('h3');
                    h3.className = 'text-lg font-semibold text-white mb-2';
                    h3.textContent = title;
                    const ul = document.createElement('ul');
                    ul.className = 'space-y-3 text-sm bg-gray-900 p-4 rounded-lg border border-gray-700';
                    wrapper.append(h3, ul);
                    return { wrapper, ul };
                };

                const createListItem = (key, value) => {
                    const li = document.createElement('li');
                    li.className = 'flex flex-col sm:flex-row';
                    const strong = document.createElement('strong');
                    strong.className = 'w-40 flex-shrink-0 text-gray-400';
                    strong.textContent = key;
                    const div = document.createElement('div');
                    div.className = 'flex-grow text-white break-all';
                    div.textContent = value;
                    li.append(strong, div);
                    return li;
                };

                const parsePdfDate = (pdfDate) => {
                    if (!pdfDate || typeof pdfDate !== 'string' || !pdfDate.startsWith('D:')) return pdfDate;
                    try {
                        const year = pdfDate.substring(2, 6);
                        const month = pdfDate.substring(6, 8);
                        const day = pdfDate.substring(8, 10);
                        const hour = pdfDate.substring(10, 12);
                        const minute = pdfDate.substring(12, 14);
                        const second = pdfDate.substring(14, 16);
                        return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`).toLocaleString();
                    } catch { return pdfDate; }
                };

                const infoSection = createSection('Info Dictionary');
                if (info && Object.keys(info).length > 0) {
                    for (const key in info) {
                        let value = info[key] || '- Not Set -';
                        if ((key === 'CreationDate' || key === 'ModDate') && typeof value === 'string') {
                            value = parsePdfDate(value);
                        }
                        infoSection.ul.appendChild(createListItem(key, String(value)));
                    }
                } else {
                    infoSection.ul.innerHTML = `<li><span class="text-gray-500 italic">- No Info Dictionary data found -</span></li>`;
                }
                resultsDiv.appendChild(infoSection.wrapper);

                const fieldsSection = createSection('Interactive Form Fields');
                if (fieldObjects && Object.keys(fieldObjects).length > 0) {
                    for (const fieldName in fieldObjects) {
                        const field = fieldObjects[fieldName][0];
                        const value = (field as any).fieldValue || '- Not Set -';
                        fieldsSection.ul.appendChild(createListItem(fieldName, String(value)));
                    }
                } else {
                    fieldsSection.ul.innerHTML = `<li><span class="text-gray-500 italic">- No interactive form fields found -</span></li>`;
                }
                resultsDiv.appendChild(fieldsSection.wrapper);

                const xmpSection = createSection('XMP Metadata (Raw XML)');
                const xmpContainer = document.createElement('div');
                xmpContainer.className = 'bg-gray-900 p-4 rounded-lg border border-gray-700';
                if (rawXmpString) {
                    const pre = document.createElement('pre');
                    pre.className = 'text-xs text-gray-300 whitespace-pre-wrap break-all';
                    pre.textContent = String(rawXmpString);
                    xmpContainer.appendChild(pre);
                } else {
                    xmpContainer.innerHTML = `<p class="text-gray-500 italic">- No XMP metadata found -</p>`;
                }
                xmpSection.wrapper.appendChild(xmpContainer);
                resultsDiv.appendChild(xmpSection.wrapper);

                resultsDiv.classList.remove('hidden');

            } catch (e) {
                console.error("Failed to view metadata or fields:", e);
                showAlert('Error', 'Could not fully analyze the PDF. It may be corrupted or have an unusual structure.');
            } finally {
                hideLoader();
            }
        }

        if (toolId === 'edit-metadata') {
            const form = document.getElementById('metadata-form');
            const container = document.getElementById('custom-metadata-container');
            const addBtn = document.getElementById('add-custom-meta-btn');

            const formatDateForInput = (date) => {
                if (!date) return '';
                const pad = (num) => num.toString().padStart(2, '0');
                return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
            };

            (document.getElementById('meta-title') as HTMLInputElement).value = state.pdfDoc.getTitle() || '';
            (document.getElementById('meta-author') as HTMLInputElement).value = state.pdfDoc.getAuthor() || '';
            (document.getElementById('meta-subject') as HTMLInputElement).value = state.pdfDoc.getSubject() || '';
            (document.getElementById('meta-keywords') as HTMLInputElement).value = state.pdfDoc.getKeywords() || '';
            (document.getElementById('meta-creator') as HTMLInputElement).value = state.pdfDoc.getCreator() || '';
            (document.getElementById('meta-producer') as HTMLInputElement).value = state.pdfDoc.getProducer() || '';
            (document.getElementById('meta-creation-date') as HTMLInputElement).value = formatDateForInput(state.pdfDoc.getCreationDate());
            (document.getElementById('meta-mod-date') as HTMLInputElement).value = formatDateForInput(state.pdfDoc.getModificationDate());

            addBtn.onclick = () => {
                const fieldWrapper = document.createElement('div');
                fieldWrapper.className = 'flex items-center gap-2 custom-field-wrapper';

                const keyInput = document.createElement('input');
                keyInput.type = 'text';
                keyInput.placeholder = 'Key (e.g., Department)';
                keyInput.className = 'custom-meta-key w-1/3 bg-gray-800 border border-gray-600 text-white rounded-lg p-2';

                const valueInput = document.createElement('input');
                valueInput.type = 'text';
                valueInput.placeholder = 'Value (e.g., Marketing)';
                valueInput.className = 'custom-meta-value flex-grow bg-gray-800 border border-gray-600 text-white rounded-lg p-2';

                const removeBtn = document.createElement('button');
                removeBtn.type = 'button';
                removeBtn.className = 'btn p-2 text-red-500 hover:bg-gray-700 rounded-full';
                removeBtn.innerHTML = '<i data-lucide="trash-2"></i>';
                removeBtn.addEventListener('click', () => fieldWrapper.remove());

                fieldWrapper.append(keyInput, valueInput, removeBtn);
                container.appendChild(fieldWrapper);
                createIcons({ icons });
            };

            form.classList.remove('hidden');
            createIcons({ icons });
        }

        if (toolId === 'cropper') {
            document.getElementById('cropper-ui-container').classList.remove('hidden');
        }

        if (toolId === 'page-dimensions') {
            const dimensionsLogic = await getToolLogic('page-dimensions');
            if (typeof dimensionsLogic === 'function') dimensionsLogic();
        }

        const activeLogic = await getToolLogic(toolId);
        if (activeLogic && typeof (activeLogic as any).setup === 'function') {
            (activeLogic as any).setup();
        }
    } catch (e) {
        hideLoader();
        // Surface the real reason: the old copy blamed the file for every failure, including tool init errors
        // (e.g. the OCR engine failing to load), which sent people hunting for a "corrupt PDF" that was fine.
        const detail = String((e as any)?.message || (e as any)?.name || '').slice(0, 160);
        showAlert(
            'Error',
            detail
                ? `Could not open this PDF. Detail: ${detail}`
                : 'Could not open this PDF. Try another file, or run it through Fix/Repair first — scanned images and very large files can also fail in this browser tab.'
        );
        console.error(e);
    }
}

async function handleMultiFileUpload(toolId) {
    const processBtn = document.getElementById('process-btn');
    if (processBtn) {
        (processBtn as HTMLButtonElement).disabled = false;
        const logic = await getToolLogic(toolId);
        if (logic) {
            const func = typeof (logic as any).process === 'function' ? (logic as any).process : logic;
            processBtn.onclick = func;
        }
    }

    if (toolId === 'merge') {
        const mergeLogic = await getToolLogic('merge');
        if (mergeLogic && typeof (mergeLogic as any).setup === 'function') (mergeLogic as any).setup();
    } else if (toolId === 'alternate-merge') {
        const alternateLogic = await getToolLogic('alternate-merge');
        if (alternateLogic && typeof (alternateLogic as any).setup === 'function') (alternateLogic as any).setup();
    } else if (toolId === 'image-to-pdf') {
        const imageList = document.getElementById('image-list');
        imageList.textContent = ''; // Clear safely

        state.files.forEach(file => {
            const url = URL.createObjectURL(file);
            const li = document.createElement('li');
            li.className = "relative group cursor-move";
            li.dataset.fileName = file.name;

            const img = document.createElement('img');
            img.src = url;
            img.className = "w-full h-full object-cover rounded-md border-2 border-gray-600";

            const p = document.createElement('p');
            p.className = "absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white text-xs text-center truncate p-1";
            p.textContent = file.name; // Safe insertion

            li.append(img, p);
            imageList.appendChild(li);
        });

        const { default: Sortable } = await import('sortablejs');
        Sortable.create(imageList);
    }
}

export function setupFileInputHandler(toolId) {
    const fileInput = document.getElementById('file-input');
    const isMultiFileTool = multiFileTools.includes(toolId);
    let isFirstUpload = true;

    const processFiles = async (newFiles) => {
        if (newFiles.length === 0) return;

        // SIZE GUARD FIRST — before state is touched and before anything is read. Reading the bytes
        // (readFileAsArrayBuffer / arrayBuffer()) is what allocates the whole document and can kill
        // the tab, so a too-large file must be refused, and a borderline one confirmed, here. The
        // guard module is a dynamic import: its DOM/copy bytes stay out of every page's first load.
        const { guardFilesWithUi } = await import('../fileGuardUi.js');
        if (!(await guardFilesWithUi(newFiles))) return;

        if (!isMultiFileTool || isFirstUpload) {
            state.files = newFiles;
        } else {
            state.files = [...state.files, ...newFiles];
        }
        isFirstUpload = false;

        const fileDisplayArea = document.getElementById('file-display-area');
        if (fileDisplayArea) {
            renderFileDisplay(fileDisplayArea, state.files);
        }

        const fileControls = document.getElementById('file-controls');
        if (fileControls) {
            fileControls.classList.remove('hidden');
            createIcons({ icons });
        }

        if (isMultiFileTool) {
            await handleMultiFileUpload(toolId);
        } else if (singlePdfLoadTools.includes(toolId)) {
            await handleSinglePdfUpload(toolId, state.files[0]);
        } else if (simpleTools.includes(toolId)) {
            const optionsDivId = toolId === 'change-permissions' ? 'permissions-options' : `${toolId}-options`;
            const optionsDiv = document.getElementById(optionsDivId);
            if (optionsDiv) optionsDiv.classList.remove('hidden');
            const processBtn = document.getElementById('process-btn');
            if (processBtn) {
                (processBtn as HTMLButtonElement).disabled = false;
                processBtn.onclick = async () => {
                    const logic = await getToolLogic(toolId);
                    if (logic) {
                        const func = typeof (logic as any).process === 'function' ? (logic as any).process : logic;
                        func();
                    }
                };
            }
        }
    };

    fileInput.addEventListener('change', (e) => processFiles(Array.from((e.target as HTMLInputElement).files || [])));

    // Dropping a file used to work because the transparent input covered the whole zone and absorbed
    // the native drop. The input is now visually hidden (see createFileInputHTML), so the zone itself
    // has to be the drop target.
    const dropZoneEl = document.getElementById('drop-zone');
    if (dropZoneEl && typeof processFiles === 'function') {
        dropZoneEl.addEventListener('dragover', (event) => {
            event.preventDefault();
            dropZoneEl.classList.add('is-over');
        });
        dropZoneEl.addEventListener('dragleave', () => dropZoneEl.classList.remove('is-over'));
        dropZoneEl.addEventListener('drop', (event) => {
            event.preventDefault();
            dropZoneEl.classList.remove('is-over');
            const dropped = (event as DragEvent).dataTransfer?.files;
            void processFiles(Array.from(dropped || []));
        });
    }

    const setupAddMoreButton = () => {
        const addMoreBtn = document.getElementById('add-more-btn');
        if (addMoreBtn) {
            addMoreBtn.addEventListener('click', () => fileInput.click());
        }
    };

    const setupClearButton = () => {
        const clearBtn = document.getElementById('clear-files-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                state.files = [];
                isFirstUpload = true;
                (fileInput as HTMLInputElement).value = '';

                const fileDisplayArea = document.getElementById('file-display-area');
                if (fileDisplayArea) fileDisplayArea.textContent = '';

                const fileControls = document.getElementById('file-controls');
                if (fileControls) fileControls.classList.add('hidden');

                const toolSpecificUI = ['file-list', 'page-merge-preview', 'image-list', 'alternate-file-list'];
                toolSpecificUI.forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.textContent = '';
                });

                const processBtn = document.getElementById('process-btn');
                if (processBtn) (processBtn as HTMLButtonElement).disabled = true;
            });
        }
    };

    setTimeout(() => {
        setupAddMoreButton();
        setupClearButton();
    }, 100);
}
