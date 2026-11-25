import type * as PdfjsModule from 'pdfjs-dist';

type Pdfjs = typeof PdfjsModule;

let ready: Promise<Pdfjs> | null = null;

/**
 * Configure and expose pdf.js exactly once per page.
 *
 * Two things have to happen before any tool touches pdf.js:
 *  1. `GlobalWorkerOptions.workerSrc` must point at the bundled worker, otherwise pdf.js throws
 *     "No GlobalWorkerOptions.workerSrc specified" (this is what the app entry used to do in main.ts).
 *  2. several tool modules and ui.ts read a bare `pdfjsLib` global, so it has to exist on `window`.
 *
 * The module stays dynamic so a page only downloads pdf.js when the tool it mounts actually needs it.
 */
export function ensurePdfjs(): Promise<Pdfjs> {
    if (!ready) {
        ready = import('pdfjs-dist').then((mod) => {
            mod.GlobalWorkerOptions.workerSrc = new URL(
                'pdfjs-dist/build/pdf.worker.min.mjs',
                import.meta.url
            ).toString();
            (window as any).pdfjsLib = mod;
            return mod;
        });
    }
    return ready;
}
