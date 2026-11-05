declare module 'bun:test' {
  export const afterEach: (callback: () => unknown | Promise<unknown>) => void;
  export const beforeEach: (callback: () => unknown | Promise<unknown>) => void;
  export const expect: any;
  export const test: (name: string, callback: () => unknown | Promise<unknown>) => void;
}
