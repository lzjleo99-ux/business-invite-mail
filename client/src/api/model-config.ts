import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  ModelConfig,
  UpdateModelConfigRequest,
  TestConnectionRequest,
  TestConnectionResponse,
  ImportSecretConfig,
  UpdateImportSecretRequest,
} from '@shared/api.interface';

export async function getModelConfig(): Promise<ModelConfig> {
  const response = await axiosForBackend.get('/api/model-config');
  return response.data;
}

export async function updateModelConfig(data: UpdateModelConfigRequest): Promise<ModelConfig> {
  const response = await axiosForBackend.patch('/api/model-config', data);
  return response.data;
}

export async function testConnection(
  data: TestConnectionRequest,
): Promise<TestConnectionResponse> {
  const response = await axiosForBackend.post('/api/model-config/test', data);
  return response.data;
 }

export async function getImportSecret(): Promise<ImportSecretConfig> {
  const response = await axiosForBackend.get('/api/settings/import-secret');
  return response.data;
}

export async function updateImportSecret(
  data: UpdateImportSecretRequest,
): Promise<ImportSecretConfig> {
  const response = await axiosForBackend.post('/api/settings/import-secret', data);
  return response.data;
}
