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

export async function createUser(params: {
  email: string;
  password: string;
  displayName: string;
}): Promise<AdminUser> {
  const response = await axiosForBackend.post('/api/admin/users', params);
  return response.data;
}

export interface SmtpConfigResponse {
  configured: boolean;
  host?: string;
  port?: number;
  secure?: boolean;
  username?: string | null;
  passwordSet?: boolean;
  fromName?: string | null;
  fromEmail?: string;
}

export async function getSmtpConfig(): Promise<SmtpConfigResponse> {
  const response = await axiosForBackend.get('/api/admin/smtp-config');
  return response.data;
}

export async function saveSmtpConfig(params: {
  host: string;
  port: string;
  secure: boolean;
  username?: string;
  password?: string;
  fromName?: string;
  fromEmail: string;
}): Promise<{ success: boolean }> {
  const response = await axiosForBackend.post('/api/admin/smtp-config', params);
  return response.data;
}

export async function testSmtp(to: string): Promise<{ success: boolean }> {
  const response = await axiosForBackend.post('/api/admin/smtp-test', { to });
  return response.data;
}
