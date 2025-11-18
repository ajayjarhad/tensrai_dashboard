import { z } from 'zod';

export const LoginCredentialsSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

export const FirstTimePasswordSetupSchema = z
  .object({
    tempPassword: z.string().min(1, 'Temporary password is required'),
    newPassword: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Password confirmation is required'),
    displayName: z.string().optional(),
  })
  .refine(data => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export type LoginCredentialsInput = z.infer<typeof LoginCredentialsSchema>;
export type FirstTimePasswordSetupInput = z.infer<typeof FirstTimePasswordSetupSchema>;
