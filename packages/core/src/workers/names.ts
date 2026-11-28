/**
 * Uniqueness key of a worker name (0.2 #049): NFC, lower case, trimmed, inner runs of
 * whitespace collapsed. Computed only here so JS and PostgreSQL never disagree (design D1).
 */
export function workerNameKey(name: string): string {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');
}

/** Up to two initials for the generated avatar (design D9, 0.2 #111). */
export function workerInitials(name: string): string {
  const words = name
    .normalize('NFC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '');
  return words
    .slice(0, 2)
    .map((word) => word.charAt(0).toLocaleUpperCase('vi'))
    .join('');
}

/** Number of fixed avatar colours; `avatar_color` is an index into the web palette. */
export const AVATAR_COLOR_COUNT = 8;

/** Stable colour index for a new worker, from its name. */
export function avatarColorFor(name: string): number {
  let hash = 0;
  for (const char of workerNameKey(name)) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return hash % AVATAR_COLOR_COUNT;
}
