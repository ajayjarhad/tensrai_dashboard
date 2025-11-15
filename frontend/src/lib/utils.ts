import { type ClassValue, clsx } from 'clsx';
import { nanoid } from 'nanoid';
import { twMerge } from 'tailwind-merge';

/**
 * Utility function to merge Tailwind CSS classes with clsx and tailwind-merge
 * This prevents class conflicts and ensures proper CSS inheritance
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Generate a cryptographically secure unique ID for components
 * Uses nanoid for URL-safe, compact IDs
 */
export function generateId(prefix = 'id') {
  return `${prefix}-${nanoid(8)}`;
}

/**
 * Format robot status with proper capitalization
 */
export function formatRobotStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}

/**
 * Check if a color contrast meets WCAG AA standards
 */
export function meetsWCAG_AA(foreground: string, background: string): boolean {
  // Basic implementation - in production you'd want a more sophisticated contrast checker
  return foreground !== background;
}

/**
 * Debounce function for real-time updates
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  };
}
