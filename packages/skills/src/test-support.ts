import type { PackageFile } from './package.ts';

/** Helpers for this package's tests. */
export const text = (path: string, content: string): PackageFile => ({
  path,
  bytes: new TextEncoder().encode(content),
});
export const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
export const skillMd = (
  name = 'lap-bao-gia',
  extra = '',
  body = '# Lập báo giá\n\nSoạn văn bản.\n',
) => `---\nname: ${name}\ndescription: Soạn báo giá theo mẫu.${extra}\n---\n${body}`;
