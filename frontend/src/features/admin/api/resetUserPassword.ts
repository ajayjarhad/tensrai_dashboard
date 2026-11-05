import { apiClient } from '@/lib/api';

export interface ResetUserPasswordResult {
  username: string;
  email: string;
  tempPassword: string;
}

export const resetUserPassword = async (userId: string): Promise<ResetUserPasswordResult> => {
  const response = await apiClient.post<{ success: boolean; data: ResetUserPasswordResult }>(
    `users/${userId}/reset-password`
  );
  return response.data;
};
