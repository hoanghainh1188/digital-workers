const SOURCE = /^[a-z0-9:/._-]{1,200}$/;

export class InvalidDataSourceError extends Error {
  constructor() {
    super('Data source may contain only [a-z0-9:/._-]');
    this.name = 'InvalidDataSourceError';
  }
}

/**
 * Marks outside content as data for the model (design D8.4, FR-05-07, CLAUDE.md). The
 * content cannot close or open the tag: the `<` of every `</data` and `<data` (any case)
 * becomes `&lt;`. This lowers prompt-injection risk; it never replaces permission checks.
 */
export function wrapData(source: string, content: string): string {
  if (!SOURCE.test(source)) throw new InvalidDataSourceError();
  const safe = content.replace(/<(\/?data)/gi, '&lt;$1');
  return `<data source="${source}">\n${safe}\n</data>`;
}
