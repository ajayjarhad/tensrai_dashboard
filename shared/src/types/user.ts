import type { Role } from '../constants/permissions.js';

export interface User {
  id: string;
  orgId: string;
  orgName?: string | null;
  // Differs from orgId only while a staff member is inside another organization.
  homeOrgId?: string;
  username: string;
  email: string;
  role: Role;
  displayName?: string;
  mustResetPassword: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ResetPasswordInput {
  tempPassword: string;
  newPassword: string;
  confirmPassword: string;
  displayName?: string;
}

export interface LoginCredentials {
  username: string;
  password: string;
}
