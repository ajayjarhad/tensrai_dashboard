import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { createUser, deleteUser, getUsers, resetUserPassword, updateUser } from '../api';

export function useUsers() {
  return useQuery({
    queryKey: queryKeys.users.lists,
    queryFn: getUsers,
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.lists });
    },
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      userId,
      userData,
    }: {
      userId: string;
      userData: Parameters<typeof updateUser>[1];
    }) => updateUser(userId, userData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.lists });
    },
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.lists });
    },
  });
}

export function useResetUserPassword() {
  return useMutation({ mutationFn: resetUserPassword });
}
