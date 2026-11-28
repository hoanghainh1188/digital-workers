import { describe, expect, it } from 'vitest';
import { splitText } from './split-text.ts';

const graphemes = (text: string) =>
  [...new Intl.Segmenter('vi', { granularity: 'grapheme' }).segment(text)].map((s) => s.segment);
const squash = (text: string) => text.replace(/\s+/g, '');

describe('splitText (design D10)', () => {
  it('keeps a short text whole and an empty text empty', () => {
    expect(splitText('Xin chào', 2000)).toEqual(['Xin chào']);
    expect(splitText('', 2000)).toEqual([]);
  });

  it('4.500 characters / 2.000 → 3 parts, nothing lost, no word cut', () => {
    const sentence = 'Báo giá gốm sứ Bát Tràng cho khách sỉ tháng mười hai. ';
    const text = sentence
      .repeat(Math.ceil(4500 / sentence.length))
      .slice(0, 4500)
      .trim();
    const parts = splitText(text, 2000);
    expect(parts).toHaveLength(3);
    expect(parts.every((part) => part.length <= 2000)).toBe(true);
    expect(squash(parts.join(''))).toBe(squash(text));
    for (const part of parts) {
      expect(part).toBe(part.trim());
      expect(text.includes(part)).toBe(true);
    }
  });

  it('prefers paragraph, then line boundaries', () => {
    const a = 'a'.repeat(1200);
    const b = 'b'.repeat(1200);
    expect(splitText(`${a}\n\n${b}`, 2000)).toEqual([a, b]);
    expect(splitText(`${a}\n${b}`, 2000)).toEqual([a, b]);
  });

  it('never cuts an emoji or a Vietnamese letter with combining marks', () => {
    const decomposed = 'ệ'.normalize('NFD'); // e + two combining marks
    const text = `${'😀'.repeat(1500)}${decomposed.repeat(700)}`;
    const parts = splitText(text, 2000);
    expect(parts.join('')).toBe(text);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(2000);
      expect(graphemes(part).every((g) => graphemes(text).includes(g))).toBe(true);
      expect(/^[̀-ͯ]/.test(part)).toBe(false);
      expect(/[\ud800-\udbff]$/.test(part)).toBe(false);
    }
  });

  it('property: random texts keep every non-space character, in order, within max', () => {
    const alphabet = ['a', 'ê', 'ố', ' ', '\n', '.', '😀', 'đ', 'ư', '\n\n', 'ạ'];
    let seed = 42;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let run = 0; run < 200; run += 1) {
      const length = Math.floor(random() * 3000);
      let text = '';
      for (let i = 0; i < length; i += 1) text += alphabet[Math.floor(random() * alphabet.length)];
      const max = 10 + Math.floor(random() * 500);
      const parts = splitText(text, max);
      expect(parts.every((part) => part.length > 0 && part.length <= max)).toBe(true);
      expect(squash(parts.join(''))).toBe(squash(text));
    }
  });
});
