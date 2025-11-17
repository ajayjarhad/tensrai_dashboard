import crypto from 'node:crypto';
import type { Prisma, PrismaClient, Role, User } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { AuthTracer } from '../utils/tracing.js';

export interface CreateUserInput {
  username: string;
  email: string;
  role: Role;
  displayName?: string;
}

interface CreateUserResponse {
  user: Pick<User, 'id' | 'username' | 'email' | 'role' | 'displayName'>;
  tempPassword: string;
}

export interface ResetPasswordInput {
  tempPassword: string;
  newPassword: string;
  confirmPassword: string;
  displayName?: string;
}

/**
 * Generate a secure random temporary password
 */
function generateTempPassword(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < 20; i++) {
    password += chars.charAt(crypto.randomInt(0, chars.length));
  }
  return password;
}

/**
 * Log audit event helper
 */
async function logAuditEvent(
  prisma: PrismaClient,
  event: {
    userId: string;
    role: string;
    action: string;
    targetUserId?: string;
    metadata?: Prisma.InputJsonValue | null;
  }
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: event.userId,
        role: event.role,
        action: event.action,
        timestamp: new Date(),
        metadata: event.metadata ?? null,
      },
    });
  } catch (error) {
    console.error('Failed to log audit event:', error);
  }
}

/**
 * Create a new user with a temporary password (admin workflow)
 * Returns the temp password for admin to share manually
 */
export async function createUserWithTempPassword(
  prisma: PrismaClient,
  userData: CreateUserInput,
  adminUserId: string,
  adminRole: string
): Promise<CreateUserResponse> {
  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ email: userData.email }, { username: userData.username }],
    },
  });

  if (existingUser) {
    throw new Error('User with this email or username already exists');
  }

  const tempPassword = generateTempPassword();
  const tempPasswordHash = await bcrypt.hash(tempPassword, 12);
  const tempPasswordExpiry = new Date(Date.now() + 72 * 60 * 60 * 1000);

  const user = await prisma.user.create({
    data: {
      username: userData.username,
      email: userData.email,
      displayName: userData.displayName || userData.username,
      role: userData.role,
      tempPasswordHash,
      tempPasswordExpiry,
      mustResetPassword: true,
      isActive: true,
      passwordHash: '',
    },
  });

  await logAuditEvent(prisma, {
    userId: adminUserId,
    role: adminRole,
    action: 'TEMP_PASSWORD_CREATED',
    targetUserId: user.id,
    metadata: {
      targetUserEmail: user.email,
      targetUsername: user.username,
      tempPasswordExpiry: tempPasswordExpiry.toISOString(),
    },
  });

  AuthTracer.traceUserManagement('user_created_with_temp_password', adminUserId, user.id, {
    targetUserEmail: user.email,
    targetUsername: user.username,
    targetRole: user.role,
    tempPasswordExpiry: tempPasswordExpiry.toISOString(),
  });

  return {
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role as Role,
      displayName: user.displayName,
    },
    tempPassword,
  };
}

/**
 * Handle password reset using temporary password
 */
export async function resetPasswordWithTemp(
  prisma: PrismaClient,
  userId: string,
  resetData: ResetPasswordInput
): Promise<{ success: boolean; message: string }> {
  if (resetData.newPassword !== resetData.confirmPassword) {
    throw new Error('Passwords do not match');
  }

  if (resetData.newPassword.length < 8) {
    throw new Error('Password must be at least 8 characters long');
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new Error('User not found');
  }

  if (!user.tempPasswordHash || !user.tempPasswordExpiry) {
    throw new Error('No temporary password found for this user');
  }

  if (new Date() > user.tempPasswordExpiry) {
    throw new Error('Temporary password has expired');
  }

  const isTempPasswordValid = await bcrypt.compare(resetData.tempPassword, user.tempPasswordHash);

  if (!isTempPasswordValid) {
    throw new Error('Invalid temporary password');
  }

  const newPasswordHash = await bcrypt.hash(resetData.newPassword, 12);

  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: newPasswordHash,
      tempPasswordHash: null,
      tempPasswordExpiry: null,
      mustResetPassword: false,
      displayName: resetData.displayName || user.displayName,
      updatedAt: new Date(),
    },
  });

  await logAuditEvent(prisma, {
    userId: user.id,
    role: user.role,
    action: 'PASSWORD_RESET',
    metadata: {
      wasTempPassword: true,
      passwordChangedAt: new Date().toISOString(),
    },
  });

  AuthTracer.traceAuthAttempt('password_reset_with_temp', user.id, true, undefined, {
    wasTempPassword: true,
    passwordChangedAt: new Date().toISOString(),
    method: 'temporary_password',
  });

  return {
    success: true,
    message: 'Password reset successfully',
  };
}

/**
 * Get user by ID (safe - excludes sensitive data)
 */
export async function getUserById(
  prisma: PrismaClient,
  userId: string
): Promise<Partial<User> | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      displayName: true,
      mustResetPassword: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return user;
}

/**
 * Get all users (admin only)
 */
export async function getAllUsers(prisma: PrismaClient): Promise<Partial<User>[]> {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      displayName: true,
      mustResetPassword: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  return users;
}

/**
 * Update user (admin only)
 */
export async function updateUser(
  prisma: PrismaClient,
  userId: string,
  updateData: Partial<User>,
  adminUserId: string,
  adminRole: string
): Promise<Partial<User>> {
  const currentUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      ...updateData,
      updatedAt: new Date(),
    },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      displayName: true,
      mustResetPassword: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (updateData.role && currentUser && updateData.role !== currentUser.role) {
    await logAuditEvent(prisma, {
      userId: adminUserId,
      role: adminRole,
      action: 'ROLE_CHANGED',
      targetUserId: user.id,
      metadata: {
        oldRole: currentUser.role,
        newRole: updateData.role,
      },
    });
  }

  return user;
}

/**
 * Delete user (admin only)
 */
export async function deleteUser(
  prisma: PrismaClient,
  userId: string,
  adminUserId: string,
  adminRole: string
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new Error('User not found');
  }

  await prisma.user.delete({
    where: { id: userId },
  });

  await logAuditEvent(prisma, {
    userId: adminUserId,
    role: adminRole,
    action: 'USER_DELETED',
    targetUserId: user.id,
    metadata: {
      deletedUserEmail: user.email,
      deletedUsername: user.username,
    },
  });
}
