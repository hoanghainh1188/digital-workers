import { type MessageKey, vi } from './vi.ts';

/** Returns the Vietnamese string for `key`. Unknown keys fail at typecheck time. */
export function t(key: MessageKey): string {
  return vi[key];
}

export function isMessageKey(key: string): key is MessageKey {
  return Object.hasOwn(vi, key);
}

/** `t(key)` with `{name}` placeholders filled from `values`. */
export function tf(key: MessageKey, values: Readonly<Record<string, string | number>>): string {
  return t(key).replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}
