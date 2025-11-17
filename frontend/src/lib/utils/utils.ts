import { type ClassValue, clsx } from 'clsx';
import { nanoid } from 'nanoid';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateId(prefix = 'id') {
  return `${prefix}-${nanoid(8)}`;
}

export function formatRobotStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}

export function meetsWCAG_AA(foreground: string, background: string): boolean {
  // Simple WCAG AA contrast checker for grayscale values
  // Returns true if contrast ratio is >= 4.5:1
  try {
    // Extract lightness values from HSL strings (format: "0 0% XX%")
    const getLightness = (color: string): number => {
      const match = color.match(/(\d+)%/);
      return match ? Number.parseInt(match[1], 10) : 50;
    };

    const fgLightness = getLightness(foreground);
    const bgLightness = getLightness(background);

    // Calculate relative luminance (simplified for grayscale)
    const getLuminance = (lightness: number): number => {
      const normalized = lightness / 100;
      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    };

    const L1 = getLuminance(fgLightness) + 0.05;
    const L2 = getLuminance(bgLightness) + 0.05;

    const contrast = L1 / L2 >= L2 / L1 ? L1 / L2 : L2 / L1;

    return contrast >= 4.5;
  } catch {
    // Fallback: assume good contrast if colors are different
    return foreground !== background;
  }
}

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
