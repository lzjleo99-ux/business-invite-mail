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

/** 测试推送：会真实往群里发一条消息。传入未保存的地址即可先测再存 */
export async function testWecomNotify(
  webhookUrl?: string,
): Promise<{ ok: boolean; message: string }> {
  const response = await axiosForBackend.post(
    '/api/admin/wecom-notify-test',
    { webhookUrl },
    { timeout: 30_000 },
  );
  return response.data;
}

// --- 多个发信账号（邮箱后台） ---

export interface SmtpAccount {
  id: string;
  email: string;
  /** 授权码明文（设置页要能直接看并改，见 MailService.listAccounts 注释） */
  password: string;
  host: string;
  port: number;
  secure: boolean;
  fromName: string | null;
  isDefault: boolean;
}

/** 更新发信账号（设置页点进某个邮箱后编辑） */
export async function updateSmtpAccount(
  id: string,
  data: {
    email?: string;
    password?: string;
    host?: string;
    port?: number;
    secure?: boolean;
    fromName?: string | null;
  },
): Promise<{ ok: true }> {
  const response = await axiosForBackend.patch(`/api/admin/smtp-accounts/${id}`, data);
  return response.data;
}

export async function listSmtpAccounts(): Promise<SmtpAccount[]> {
  const response = await axiosForBackend.get('/api/admin/smtp-accounts');
  return (response.data?.items ?? []) as SmtpAccount[];
}

export async function addSmtpAccount(input: {
  email: string;
  password: string;
  host: string;
  port: number;
  secure: boolean;
  fromName?: string;
}): Promise<{ id: string }> {
  const response = await axiosForBackend.post('/api/admin/smtp-accounts', input);
  return response.data;
}

export async function deleteSmtpAccount(id: string): Promise<void> {
  await axiosForBackend.delete(`/api/admin/smtp-accounts/${id}`);
}

export async function setDefaultSmtpAccount(id: string): Promise<void> {
  await axiosForBackend.post(`/api/admin/smtp-accounts/${id}/default`, {});
}

/** 授予超级管理员（全系统唯一，只能由现任超级管理员操作） */
export async function setSuperAdmin(userId: string): Promise<{ ok: true }> {
  const response = await axiosForBackend.post(`/api/admin/super-admin/${userId}`, {});
  return response.data;
}
