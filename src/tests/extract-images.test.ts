import { describe, it, expect } from 'vitest';
import { imageFileName, isUsableImage } from '@/js/logic/extract-images';

/**
 * The pure decisions of Extract Images: which embedded images are worth extracting, and what they are
 * called in the archive. The pixel work itself is verified against the built page in
 * scripts/verify-a-tier.mjs.
 */
describe('extract-images', () => {
  describe('isUsableImage', () => {
    it('keeps an image big enough to be content', () => {
      expect(isUsableImage(120, 80)).toBe(true);
      expect(isUsableImage(16, 16)).toBe(true);
    });

    it('drops decoration smaller than 16px on either side', () => {
      expect(isUsableImage(15, 400)).toBe(false);
      expect(isUsableImage(400, 8)).toBe(false);
      expect(isUsableImage(0, 0)).toBe(false);
    });

    it('refuses an image too large to decode safely', () => {
      expect(isUsableImage(10000, 10000)).toBe(false); // 100 MP
      expect(isUsableImage(6000, 6000)).toBe(true); // 36 MP
    });

    it('rejects nonsense dimensions rather than painting them', () => {
      expect(isUsableImage(NaN, 100)).toBe(false);
      expect(isUsableImage(undefined as unknown as number, 100)).toBe(false);
    });
  });

  describe('imageFileName', () => {
    it('sorts by page, then by index, inside the archive', () => {
      expect(imageFileName(1, 1, 'png')).toBe('p01-img01.png');
      expect(imageFileName(12, 3, 'jpg')).toBe('p12-img03.jpg');
    });
  });
});
