import { describe, it, expect } from 'vitest';
import { singlePdfLoadTools, simpleTools, multiFileTools } from '@/js/config/pdf-tools';

describe('Tool Configuration Arrays', () => {

  // --- Tests for singlePdfLoadTools ---
  describe('singlePdfLoadTools', () => {
    it('should be an array of non-empty strings', () => {
      expect(Array.isArray(singlePdfLoadTools)).toBe(true);
      expect(singlePdfLoadTools.length).toBeGreaterThan(0);
      for (const tool of singlePdfLoadTools) {
        expect(typeof tool).toBe('string');
        expect(tool.length).toBeGreaterThan(0);
      }
    });

    it('should have the correct number of tools', () => {
      // This acts as a snapshot test to catch unexpected additions/removals.
      // 38 (not the original 39): 'page-dimensions' became a workbench entry and must not take the
      // single-file load path, or the earlier branch swallows it before the workbench mount runs.
      // 37: 'sign-pdf' left the list for the same reason — the workbench's signature mode replaced
      // our own single-PDF signer, so /sign-pdf/ now routes to the workbench.
      // 38: 'edit-bookmarks' — it edits the outline of the loaded document, so it takes this path.
      // 40: 'table-of-contents' (reads the outline, inserts a page) and 'add-page-labels' (writes
      // /PageLabels on the catalog) — both work on the pdf-lib document this path loads.
      expect(singlePdfLoadTools).toHaveLength(38);
    });

    it('should not contain any duplicate tools', () => {
      const uniqueTools = new Set(singlePdfLoadTools);
      expect(uniqueTools.size).toBe(singlePdfLoadTools.length);
    });
  });

  // --- Tests for simpleTools ---
  describe('simpleTools', () => {
    it('should be an array of non-empty strings', () => {
      expect(Array.isArray(simpleTools)).toBe(true);
      expect(simpleTools.length).toBeGreaterThan(0);
      simpleTools.forEach(tool => {
        expect(typeof tool).toBe('string');
        expect(tool.length).toBeGreaterThan(0);
      });
    });

    it('should have the correct number of tools', () => {
      // 6 (not the original 5): 'pdf-to-word' was implemented as a real converter, not a redirect.
      // 8: 'pdf-to-text' + 'extract-images' — text/image readers that load pdf.js in their own module.
      // 10: 'pdf-to-csv' + 'pdf-to-excel' — table readers, same shape (own pdf.js read, browser-built file).
      expect(simpleTools).toHaveLength(9);
    });

    it('should not contain any duplicate tools', () => {
      const uniqueTools = new Set(simpleTools);
      expect(uniqueTools.size).toBe(simpleTools.length);
    });
  });

  // --- Tests for multiFileTools ---
  describe('multiFileTools', () => {
    it('should be an array of non-empty strings', () => {
      expect(Array.isArray(multiFileTools)).toBe(true);
      expect(multiFileTools.length).toBeGreaterThan(0);
      multiFileTools.forEach(tool => {
        expect(typeof tool).toBe('string');
        expect(tool.length).toBeGreaterThan(0);
      });
    });

    it('should have the correct number of tools', () => {
      // 12: 'bates-numbering' — one continuous counter across every file in the run.
      expect(multiFileTools).toHaveLength(12);
    });

    it('should not contain any duplicate tools', () => {
      const uniqueTools = new Set(multiFileTools);
      expect(uniqueTools.size).toBe(multiFileTools.length);
    });
  });

  // --- Cross-Category Uniqueness Test ---
  describe('Uniqueness Across All Tool Categories', () => {
    it('should ensure no tool exists in more than one category', () => {
      const allTools = [
        ...singlePdfLoadTools,
        ...simpleTools,
        ...multiFileTools,
      ];
      const uniqueTools = new Set(allTools);

      // If the size of the Set is different from the length of the combined array,
      // it means there was at least one duplicate tool across the categories.
      expect(uniqueTools.size).toBe(allTools.length);
    });
  });

  // --- Workbench (Route A) entries ---
  // /edit-pdf/, /pdf-page-dimensions/, /annotate-pdf/ and /stamp-pdf/ all mount the workbench island,
  // which is the LAST `else if` in the file handler's dispatch chain. An id that is also in an earlier
  // list never reaches it — the feature silently never starts (this hid /edit-pdf/ once and
  // /pdf-page-dimensions/ after it). The two newest entries are pre-registered here so a later batch
  // cannot add them to a load list by accident.
  describe('workbench entries stay out of the load lists', () => {
    const WORKBENCH_ENTRY_TOOL_IDS = ['annotate', 'stamp', 'sign-pdf'];

    it('does not list a workbench entry as a single-PDF / simple / multi-file tool', () => {
      const loadLists = {
        singlePdfLoadTools,
        simpleTools,
        multiFileTools,
      };
      const offenders = WORKBENCH_ENTRY_TOOL_IDS.flatMap((id) =>
        Object.entries(loadLists)
          .filter(([, list]) => (list as string[]).includes(id))
          .map(([name]) => `${id} is in ${name}`),
      );
      expect(offenders).toEqual([]);
    });
  });

});