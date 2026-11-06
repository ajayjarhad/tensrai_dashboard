import { type ClassValue, clsx } from 'clsx';
import { nanoid } from 'nanoid';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateId(prefix = 'id') {
  return `${prefix}-${nanoid(8)}`;
}

export function generateRequestId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return nanoid();
}
