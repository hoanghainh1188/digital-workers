import { type MessageKey, vi } from './vi.ts';

/** Returns the Vietnamese string for `key`. Unknown keys fail at typecheck time. */
export function t(key: MessageKey): string {
  return vi[key];
}
