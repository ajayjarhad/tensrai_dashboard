declare module '@tensrai/shared' {
  export const ROLE: {
    readonly ADMIN: 'ADMIN';
    readonly USER: 'USER';
  };

  export const ROLE_PERMISSIONS: {
    readonly ADMIN: readonly string[];
    readonly USER: readonly string[];
  };

  export type Permission = string;

  export interface User {
    id: string;
    username: string;
    email: string;
    role: string;
    displayName?: string;
    mustResetPassword: boolean;
    isActive: boolean;
  }
}
