import clsx, { type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Standard cn helper: combines clsx (conditional classes) with tailwind-merge
// (resolves conflicts like `px-2 px-4` -> `px-4`).
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
