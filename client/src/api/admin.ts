import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type { AdminUser, AdminUserListResponse } from '@shared/api.interface';

export async function listUsers(params: {
  page: number;
  pageSize: number;
  search?: string;
}): Promise<AdminUserListResponse> {
  const response = await axiosForBackend.get('/api/admin/users', { params });
  return response.data;
}

export async function updateUserRole(
  userId: string,
  role: 'admin' | 'user',
): Promise<AdminUser> {
  const response = await axiosForBackend.patch(
    `/api/admin/users/${userId}/role`,
    { role },
  );
  return response.data;
}

export async function updateUserActive(
  userId: string,
  isActive: boolean,
): Promise<AdminUser> {
  const response = await axiosForBackend.patch(
    `/api/admin/users/${userId}/active`,
    { isActive },
  );
  return response.data;
}
