import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type { SenderProfile, SenderProfileInput } from '@shared/api.interface';
export type { SenderProfile, SenderProfileInput };

export async function listProfiles(): Promise<SenderProfile[]> {
  const response = await axiosForBackend.get('/api/sender-profiles');
  return response.data.items;
}

export async function createProfile(
  data: SenderProfileInput,
): Promise<SenderProfile> {
  const response = await axiosForBackend.post('/api/sender-profiles', data);
  return response.data;
}

export async function updateProfile(
  id: string,
  data: Partial<SenderProfileInput>,
): Promise<SenderProfile> {
  const response = await axiosForBackend.patch(`/api/sender-profiles/${id}`, data);
  return response.data;
}

export async function deleteProfile(id: string): Promise<void> {
  await axiosForBackend.delete(`/api/sender-profiles/${id}`);
}

export async function setDefaultProfile(id: string): Promise<SenderProfile> {
  const response = await axiosForBackend.post(`/api/sender-profiles/${id}/default`);
  return response.data;
}

export async function uploadProfileImage(file: File): Promise<{ id: string; url: string }> {
  const form = new FormData();
  form.append('file', file);
  const response = await axiosForBackend.post('/api/sender-profiles/images', form);
  return response.data;
}

// ---- 每公司邮件附件 ----

export interface EmailAttachment {
  id: string;
  filename: string;
  mime: string;
  size: number;
}

export async function listAttachments(companyId: string): Promise<EmailAttachment[]> {
  const response = await axiosForBackend.get(`/api/email-generator/attachments/${companyId}`);
  return response.data.items;
}

export async function uploadAttachment(
  companyId: string,
  file: File,
): Promise<EmailAttachment> {
  const form = new FormData();
  form.append('file', file);
  const response = await axiosForBackend.post(
    `/api/email-generator/attachments/${companyId}`,
    form,
  );
  return response.data;
}

export async function deleteAttachment(id: string): Promise<void> {
  await axiosForBackend.delete(`/api/email-generator/attachments/${id}`);
}
