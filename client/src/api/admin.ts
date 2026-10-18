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
  imapHost?: string | null;
  imapPort?: number;
  imapSecure?: boolean;
  inboxPollEnabled?: boolean;
  inboxPollSeconds?: number;
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
  imapHost?: string;
  imapPort?: number;
  imapSecure?: boolean;
  inboxPollEnabled?: boolean;
  inboxPollSeconds?: number;
}): Promise<{ success: boolean }> {
  const response = await axiosForBackend.post('/api/admin/smtp-config', params);
  return response.data;
}

export async function testSmtp(to: string): Promise<{ success: boolean }> {
  const response = await axiosForBackend.post('/api/admin/smtp-test', { to });
  return response.data;
}

export interface WeComNotifyConfigDto {
  enabled: boolean;
  autoStarOnReply: boolean;
  includeSnippet: boolean;
  webhookSet: boolean;
}

/** 企业微信群机器人通知配置（webhook 只写不读，回读只给 webhookSet） */
export async function getWecomNotifyConfig(): Promise<WeComNotifyConfigDto> {
  const response = await axiosForBackend.get('/api/admin/wecom-notify-config');
  return response.data;
}

export async function saveWecomNotifyConfig(body: {
  webhookUrl?: string;
  enabled?: boolean;
  autoStarOnReply?: boolean;
  includeSnippet?: boolean;
}): Promise<{ success: boolean }> {
  const response = await axiosForBackend.post('/api/admin/wecom-notify-config', body);
  return response.data;
}

/** 测试推送：会真实往群里发一条消息 */
export async function testWecomNotify(): Promise<{ ok: boolean; message: string }> {
  const response = await axiosForBackend.post('/api/admin/wecom-notify-test', {}, { timeout: 30_000 });
  return response.data;
}
