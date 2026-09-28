import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  SenderConfig,
  UpdateSenderConfigRequest,
} from '@shared/api.interface';

export async function getSenderConfig(): Promise<SenderConfig> {
  const { data } = await axiosForBackend.get('/api/sender-config');
  return data;
}

export async function updateSenderConfig(
  data: UpdateSenderConfigRequest,
): Promise<SenderConfig> {
  const res = await axiosForBackend.patch('/api/sender-config', data);
  return res.data;
}
