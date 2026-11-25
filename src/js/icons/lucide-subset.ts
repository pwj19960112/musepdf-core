/**
 * The lucide icons the tool panels actually use — and nothing else.
 *
 * `import { icons } from 'lucide'` pulls the ENTIRE icon set (~1,900 icons) into whatever chunk
 * imports it. That chunk is `ui.ts` + `handlers/*`, which every tool page loads before it can paint,
 * so the whole catalogue was being shipped so that sixteen glyphs could be drawn. This module lists
 * those sixteen explicitly: `createIcons({ icons: toolIcons })` resolves `data-lucide="upload-cloud"`
 * to the `UploadCloud` entry exactly as before, and the first-load chunk loses ~95 KB of gzip.
 *
 * RULE: when a template starts using a new `data-lucide` name, add the PascalCase icon here. A name
 * that is missing is not a crash — lucide warns and the glyph stays blank — so `src/tests/icons.test.ts`
 * walks the tool markup and fails when a name in it has no entry.
 */
import {
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  CopyPlus,
  FileDiff,
  FileScan,
  FileText,
  GripVertical,
  Info,
  Minimize,
  Plus,
  RotateCcw,
  RotateCw,
  Trash2,
  Undo2,
  UploadCloud,
  X,
  XCircle,
  ZoomIn,
  ZoomOut,
} from 'lucide';

export const toolIcons = {
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  CopyPlus,
  FileDiff,
  FileScan,
  FileText,
  GripVertical,
  Info,
  Minimize,
  Plus,
  RotateCcw,
  RotateCw,
  Trash2,
  Undo2,
  UploadCloud,
  X,
  XCircle,
  ZoomIn,
  ZoomOut,
};

/** `upload-cloud` → `UploadCloud`, the same mapping lucide's createIcons applies to `data-lucide`. */
export function iconKey(name: string): string {
  return String(name)
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}
