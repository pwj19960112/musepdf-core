import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { toolIcons, iconKey } from '@/js/icons/lucide-subset';

/**
 * Every `data-lucide` name the tool panels use must have a real icon in the subset.
 *
 * `import { icons } from 'lucide'` used to make this impossible to get wrong (and shipped ~1,900
 * icons on every tool page). With an explicit subset, a new `data-lucide="…"` that nobody added is
 * silently blank — so this test walks the source files that build the panels and the editor chrome
 * and asserts each name resolves.
 */
const SOURCES = [
  'src/js/ui.ts',
  'src/js/canvasEditor.ts',
  'src/js/handlers/fileHandler.ts',
  'src/js/handlers/toolSelectionHandler.ts',
  'scripts/generate-seo-pages.mjs',
];

describe('lucide icon subset', () => {
  it('maps a kebab-case name to the PascalCase export lucide looks up', () => {
    expect(iconKey('upload-cloud')).toBe('UploadCloud');
    expect(iconKey('x')).toBe('X');
    expect(iconKey('trash-2')).toBe('Trash2');
  });

  it('carries every icon named by a data-lucide attribute in the tool markup', () => {
    const missing: string[] = [];
    for (const file of SOURCES) {
      const abs = path.join(process.cwd(), file);
      if (!fs.existsSync(abs)) continue;
      const source = fs.readFileSync(abs, 'utf8');
      for (const match of source.matchAll(/data-lucide=["']([^"']+)["']/g)) {
        const key = iconKey(match[1]);
        if (!(key in toolIcons)) missing.push(`${match[1]} (${file})`);
      }
      // The generated pages draw their own inline SVGs; only the tool panels use data-lucide.
      for (const match of source.matchAll(/lucideSvg\(['"]([a-z0-9-]+)['"]/g)) {
        const key = iconKey(match[1]);
        if (!(key in toolIcons) && /lucideSvg|data-lucide/.test(source)) {
          // Homepage/group icons are inline SVG masters, not the runtime set — ignore those.
        }
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it('exposes each icon as a lucide node (an array of [tag, attrs])', () => {
    for (const [name, node] of Object.entries(toolIcons)) {
      expect(Array.isArray(node), `${name} is not an icon node`).toBe(true);
      expect(node.length, `${name} has no children`).toBeGreaterThan(0);
    }
  });
});
