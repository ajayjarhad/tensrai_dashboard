import type { Role } from '../constants/permissions';

export interface User {
  id: string;
  username: string;
  email: string;
  role: Role;
  displayName?: string;
  mustResetPassword: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserInput {
  username: string;
  email: string;
  role: Role;
  displayName?: string;
}

export interface CreateUserResponse {
  user: Pick<User, 'id' | 'username' | 'email' | 'role' | 'displayName'>;
  tempPassword: string;
}

export interface UpdateUserInput {
  username?: string;
  email?: string;
  role?: Role;
  displayName?: string;
  isActive?: boolean;
  mustResetPassword?: boolean;
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

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  role: Role;
  displayName?: string;
  mustResetPassword: boolean;
}
