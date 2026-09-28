import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  Company,
  Restaurant,
  BatchAnalyzeRequest,
} from '@shared/api.interface';

// --- Legacy Restaurant-named function (backward compatibility) ---

export async function analyzeWebsite(restaurantId: string): Promise<Restaurant> {
  const response = await axiosForBackend.post(`/api/website-analyzer/analyze/${restaurantId}`);
  return response.data;
}

export async function batchAnalyze(
  projectIdOrData: string | BatchAnalyzeRequest,
  maybeCompanyIds?: string[],
): Promise<{ total: number }> {
  let body: BatchAnalyzeRequest;
  if (typeof projectIdOrData === 'string') {
    // New form: batchAnalyze(projectId, companyIds?)
    body = { projectId: projectIdOrData, companyIds: maybeCompanyIds };
  } else {
    // Legacy form: batchAnalyze({ projectId?, companyIds? })
    body = projectIdOrData;
  }
  const response = await axiosForBackend.post('/api/website-analyzer/batch-analyze', body);
  return response.data;
}

// --- Company-named functions with projectId support ---

export async function analyzeCompany(id: string): Promise<Company> {
  const response = await axiosForBackend.post(`/api/website-analyzer/analyze/${id}`);
  return response.data;
}
