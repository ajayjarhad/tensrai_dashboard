// Prisma's request errors carry a code, such as P2002 for a unique constraint or P2025 for not found.
export const errorCode = (error: unknown) =>
  error && typeof error === 'object' && 'code' in error ? error.code : undefined;
