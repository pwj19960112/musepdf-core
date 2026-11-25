import { describe, it, expect } from 'vitest';
import {
  pageTextFromItems,
  assembleDocument,
  emptyPageCount,
  textFileName,
} from '@/js/logic/pdf-to-text';

/**
 * The pure half of PDF to Text: how pdf.js text items become lines, how pages become one document,
 * and how a scan is recognised. The DOM/download half is exercised against the built site.
 */
describe('pdf-to-text', () => {
  describe('pageTextFromItems', () => {
    it('breaks lines on pdf.js hasEOL and keeps words that share a line', () => {
      const items = [
        { str: 'Hello', transform: [1, 0, 0, 1, 10, 700] },
        { str: ' world', transform: [1, 0, 0, 1, 40, 700] },
        { str: 'second line', hasEOL: true, transform: [1, 0, 0, 1, 10, 686] },
      ];
      expect(pageTextFromItems(items)).toBe('Hello world\nsecond line');
    });

    it('starts a new line when the baseline moves, even without hasEOL', () => {
      const items = [
        { str: 'alpha', transform: [1, 0, 0, 1, 10, 700] },
        { str: 'beta', transform: [1, 0, 0, 1, 10, 688] },
        { str: 'gamma', transform: [1, 0, 0, 1, 60, 688] },
      ];
      expect(pageTextFromItems(items)).toBe('alpha\nbeta gamma');
    });

    it('strips trailing spaces and ignores items that carry no string', () => {
      const items = [
        { str: 'trailing   ', transform: [1, 0, 0, 1, 10, 700] },
        { transform: [1, 0, 0, 1, 30, 700] },
      ];
      expect(pageTextFromItems(items)).toBe('trailing');
    });

    it('returns an empty string for a page with no text layer', () => {
      expect(pageTextFromItems([])).toBe('');
      expect(pageTextFromItems([{ str: '   ', transform: [1, 0, 0, 1, 0, 0] }])).toBe('');
    });
  });

  describe('assembleDocument', () => {
    it('joins pages with a blank line and ends with a single newline', () => {
      expect(assembleDocument(['one', 'two'], false)).toBe('one\n\ntwo\n');
    });

    it('writes a page banner when markers are on', () => {
      expect(assembleDocument(['one', 'two'], true)).toBe('--- Page 1 ---\none\n\n--- Page 2 ---\ntwo\n');
    });

    it('collapses runs of blank lines and drops empty pages from the middle', () => {
      expect(assembleDocument(['a\n\n\n\nb', '', 'c'], false)).toBe('a\n\nb\n\nc\n');
    });

    it('returns an empty string when there is no text at all', () => {
      expect(assembleDocument(['', '  '], false)).toBe('');
    });
  });

  describe('emptyPageCount', () => {
    it('counts pages that carry no text (the scan signal)', () => {
      expect(emptyPageCount(['a', '', '  ', 'b'])).toBe(2);
      expect(emptyPageCount(['a', 'b'])).toBe(0);
    });
  });

  describe('textFileName', () => {
    it('swaps the .pdf extension for .txt', () => {
      expect(textFileName('report.pdf')).toBe('report.txt');
      expect(textFileName('Q3 Final.PDF')).toBe('Q3 Final.txt');
      expect(textFileName('no-extension')).toBe('no-extension.txt');
    });
  });
});
