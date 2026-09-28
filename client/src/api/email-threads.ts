import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  EmailThread,
  EmailThreadListResponse,
  CreateEmailThreadRequest,
} from '@shared/api.interface';

export async function getEmailThreads(companyId: string): Promise<EmailThreadListResponse> {
  const response = await axiosForBackend.get(
    `/api/email-threads?companyId=${encodeURIComponent(companyId)}`,
  );
  return response.data;
}

export async function createEmailThread(
  data: CreateEmailThreadRequest,
): Promise<EmailThread> {
  const response = await axiosForBackend.post('/api/email-threads', data);
  return response.data;
}

export async function deleteEmailThread(id: string): Promise<void> {
  await axiosForBackend.delete(`/api/email-threads/${id}`);
}
