/** `name` rules of agentskills.io: 1–64 of a-z 0-9 -, no leading / trailing / double hyphen. */
export const NAME_MAX = 64;
export const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidName(name: string): boolean {
  return name.length >= 1 && name.length <= NAME_MAX && NAME_PATTERN.test(name);
}

/** "Lập-Báo-Giá" → "lap-bao-gia": a suggestion shown next to a bad name. */
export function suggestName(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, NAME_MAX)
    .replace(/-+$/g, '');
}
