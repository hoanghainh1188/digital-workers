import { COMMON_PASSWORDS } from './common-passwords.ts';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * True when `password` is on the common list or is a trivially guessable shape:
 * one repeated character, or a run of consecutive digits / letters (e.g. 0123456789).
 */
export function isCommonPassword(password: string): boolean {
  const normalized = password.trim().toLowerCase();
  if (COMMON_PASSWORDS.has(normalized)) return true;
  if (/^(.)\1+$/u.test(normalized)) return true;
  return isSequential(normalized);
}

function isSequential(value: string): boolean {
  if (value.length < 2 || !/^[a-z0-9]+$/.test(value)) return false;
  const step = value.charCodeAt(1) - value.charCodeAt(0);
  if (Math.abs(step) !== 1) return false;
  for (let i = 2; i < value.length; i += 1) {
    if (value.charCodeAt(i) - value.charCodeAt(i - 1) !== step) return false;
  }
  return true;
}
