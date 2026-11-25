import { state } from '../state.js';
import { dom, switchView, toolTemplates } from '../ui.js';
import { setupFileInputHandler } from './fileHandler.js';
import { getToolLogic } from '../logic/lazy.js';
import { createIcons } from 'lucide';
import { toolIcons as icons } from '../icons/lucide-subset.js';

/**
 * Mount one tool into the page.
 *
 * The tool's logic is loaded with a dynamic import (`logic/lazy.ts`) so a landing page downloads only
 * the dependencies of the tool it shows — pdf.js, Tesseract, pdfkit and friends no longer ride along
 * on every page. Async now: callers can fire and forget, the UI paints first.
 */
export async function setupToolInterface(toolId: any) {
    window.scrollTo({
        top: 0,
        left: 0,
        behavior: 'instant' as ScrollBehavior
    });

    state.activeTool = toolId;

    // A tool with an entry in `toolTemplates` renders its panel from here. A tool that has none ships
    // its panel as static markup inside `#tool-content` on its own generated page (the generator's
    // TOOL_UI map), so it costs no bytes in this shared, first-load chunk — and its first screen is
    // painted before this module even runs.
    const template = toolTemplates[toolId as keyof typeof toolTemplates];
    if (template) dom.toolContent.innerHTML = template();
    createIcons({icons});
    switchView('tool');

    // Wire the file input BEFORE loading the tool's (possibly heavy) legacy logic. `getToolLogic`
    // still pulls pdf.js and — for the workbench-owned /sign-pdf/ — the legacy html2canvas signer, so
    // awaiting it left the just-rendered `#file-input` inert for a moment. A user (or an automation)
    // that picks a file in that window lost the `change` event and the page did nothing.
    const fileInput = document.getElementById('file-input');
    if (fileInput) {
        setupFileInputHandler(toolId);
    }

    const logic = await getToolLogic(toolId);

    const processBtn = document.getElementById('process-btn');

    if (!fileInput && processBtn && logic) {
        const func = typeof (logic as any).process === 'function' ? (logic as any).process : logic;
        (processBtn as HTMLButtonElement).onclick = func as any;
    }

    // `sign-pdf` used to run its own setup after the file was chosen; the workbench owns that page
    // now (see fileHandler.ts), so its legacy logic must not attach itself to markup the workbench
    // is about to replace.
    if (logic && typeof (logic as any).setup === 'function' && toolId !== 'sign-pdf') {
        (logic as any).setup();
    }

    // Workbench entries only: a PDF handed over by the homepage dropzone is waiting in IndexedDB.
    // The consumer is a dynamic import (this file is on every page's first load, so the editor must
    // not be pulled in statically) and it refuses any tool that is not a workbench entry, so no other
    // A file may be waiting in IndexedDB (homepage drop → converter/workbench). `resume` decides
    // whether this tool is allowed to consume it, so the list of eligible ids lives in one place.
}
