// Vite adds env to import.meta at build time; Node has no such property.
type ViteImportMeta = ImportMeta & { env?: Record<string, string | undefined> };

export const getEnv = (key: string, fallback?: string): string => {
  let value: string | undefined;

  if (typeof process !== 'undefined' && process.env) {
    value = process.env[key];
  }
  // Vite replaces the literal import.meta.env, so it must stay written out in full here.
  else if (typeof import.meta !== 'undefined' && (import.meta as ViteImportMeta).env) {
    const viteEnv = (import.meta as ViteImportMeta).env;
    value = viteEnv?.[key] || viteEnv?.[`VITE_${key}`];
  }

  if (value !== undefined && value !== '') {
    return value;
  }

  if (fallback !== undefined) {
    return fallback;
  }

  throw new Error(`Missing environment variable ${key}`);
};
