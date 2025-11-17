import { apiClient } from '@/lib/api';

export const authApi = {
  login: (email: string, password: string) => apiClient.post('/auth/sign-in', { email, password }),

  logout: () => apiClient.post('/auth/sign-out'),

  getSession: () => apiClient.get('/auth/session'),

  resetPassword: (data: {
    tempPassword: string;
    newPassword: string;
    confirmPassword: string;
    displayName?: string;
  }) => apiClient.post('/auth/reset-password', data),

  refreshToken: () => apiClient.post('/auth/refresh'),
};
