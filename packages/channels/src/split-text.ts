const segmenter = new Intl.Segmenter('vi', { granularity: 'grapheme' });

/** Separators tried in order: paragraph → line → sentence → space (design D10). */
const BREAKS: readonly RegExp[] = [/\n\s*\n/g, /\n/g, /(?<=[.!?…])\s+/g, /\s+/g];

/**
 * Splits `text` into parts of at most `max` UTF-16 code units, preferring paragraph,
 * then line, sentence and word boundaries. It never cuts inside a grapheme (surrogate
 * pairs, Vietnamese combining marks, emoji sequences). Only the whitespace at a split
 * point is dropped; every other character is kept, in order.
 */
export function splitText(text: string, max: number): string[] {
  if (!Number.isInteger(max) || max < 2) throw new RangeError('max must be an integer ≥ 2');
  if (text.length <= max) return text.length > 0 ? [text] : [];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const cut = cutPoint(rest, max);
    parts.push(rest.slice(0, cut.end));
    rest = rest.slice(cut.next);
  }
  if (rest.length > 0) parts.push(rest);
  return parts.filter((part) => part.length > 0);
}

function cutPoint(text: string, max: number): { end: number; next: number } {
  const window = text.slice(0, max + 1);
  for (const pattern of BREAKS) {
    let best: { end: number; next: number } | null = null;
    for (const match of window.matchAll(pattern)) {
      const end = match.index;
      // Keep parts from getting tiny when a break sits near the start.
      if (end > 0 && end <= max && end >= max / 4) best = { end, next: end + match[0].length };
    }
    if (best) return best;
  }
  const end = graphemeBoundaryAtOrBefore(text, max);
  return { end, next: end };
}

function graphemeBoundaryAtOrBefore(text: string, max: number): number {
  let boundary = 0;
  for (const { index, segment } of segmenter.segment(text)) {
    if (index + segment.length > max) break;
    boundary = index + segment.length;
  }
  // A single grapheme longer than max (pathological): cut at a code-point boundary.
  if (boundary === 0) {
    const code = text.charCodeAt(max - 1);
    return code >= 0xd800 && code <= 0xdbff ? max - 1 : max;
  }
  return boundary;
}
