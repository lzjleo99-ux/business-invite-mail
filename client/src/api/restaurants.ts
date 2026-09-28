import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  Company,
  CompanyListParams,
  CompanyListResponse,
  CompanyStatsResponse,
  Restaurant,
  RestaurantListParams,
  RestaurantListResponse,
  RestaurantStatsResponse,
  ImportResult,
  UpdateEmailRequest,
  DuplicateCheckResponse,
  BatchDeleteRequest,
  ImportByBase64Request,
} from '@shared/api.interface';

// --- Legacy Restaurant-named functions (backward compatibility) ---

export async function getRestaurants(params: RestaurantListParams): Promise<RestaurantListResponse> {
  const searchParams = new URLSearchParams();
  if (params.page !== undefined) searchParams.set('page', String(params.page));
  if (params.pageSize !== undefined) searchParams.set('pageSize', String(params.pageSize));
  if (params.status) searchParams.set('status', params.status);
  if (params.search) searchParams.set('search', params.search);
  if (params.noEmail !== undefined) searchParams.set('noEmail', String(params.noEmail));
  const response = await axiosForBackend.get(`/api/restaurants?${searchParams.toString()}`);
  return response.data;
}

export async function getRestaurantStats(): Promise<RestaurantStatsResponse> {
  const response = await axiosForBackend.get('/api/restaurants/stats');
  return response.data;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function importExcel(
  projectIdOrFile: string | File,
  fileOrMode: File | 'append' | 'overwrite',
  maybeMode?: 'append' | 'overwrite',
): Promise<ImportResult> {
  let projectId: string | undefined;
  let file: File;
  let mode: 'append' | 'overwrite';

  if (typeof projectIdOrFile === 'string') {
    projectId = projectIdOrFile;
    file = fileOrMode as File;
    mode = maybeMode as 'append' | 'overwrite';
  } else {
    file = projectIdOrFile;
    mode = fileOrMode as 'append' | 'overwrite';
  }

  if (!projectId) {
    throw new Error('缺少项目 ID');
  }

  const contentBase64: string = await readFileAsBase64(file);
  const body: ImportByBase64Request = {
    projectId,
    mode,
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    contentBase64,
  };
  const response = await axiosForBackend.post(
    '/api/restaurants/import-base64',
    body,
    { maxContentLength: 30 * 1024 * 1024, maxBodyLength: 30 * 1024 * 1024 },
  );
  return response.data;
}

export async function deleteRestaurant(id: string): Promise<void> {
  await axiosForBackend.delete(`/api/restaurants/${id}`);
}

export async function clearAllRestaurants(): Promise<void> {
  await axiosForBackend.delete('/api/restaurants');
}

export async function updateRestaurantEmail(
  id: string,
  data: UpdateEmailRequest,
): Promise<Restaurant> {
  const response = await axiosForBackend.patch(`/api/restaurants/${id}/email`, data);
  return response.data;
}

// --- Company-named functions with projectId support ---

export async function getCompanies(params: CompanyListParams): Promise<CompanyListResponse> {
  const searchParams = new URLSearchParams();
  searchParams.set('projectId', params.projectId);
  if (params.page !== undefined) searchParams.set('page', String(params.page));
  if (params.pageSize !== undefined) searchParams.set('pageSize', String(params.pageSize));
  if (params.status) searchParams.set('status', params.status);
  if (params.search) searchParams.set('search', params.search);
  if (params.noEmail !== undefined) searchParams.set('noEmail', String(params.noEmail));
  if (params.isStarred !== undefined) searchParams.set('isStarred', String(params.isStarred));
  if (params.filterKey) searchParams.set('filterKey', params.filterKey);
  const response = await axiosForBackend.get(`/api/restaurants?${searchParams.toString()}`);
  return response.data;
}

export async function toggleStar(id: string, isStarred: boolean): Promise<Company> {
  const response = await axiosForBackend.patch(`/api/restaurants/${id}/star`, { isStarred });
  return response.data;
}

export async function updateContactStatus(
  id: string,
  type: 'whatsapp' | 'viber' | 'email',
  contacted: boolean,
): Promise<Company> {
  const response = await axiosForBackend.patch(`/api/restaurants/${id}/contact-status`, {
    type,
    contacted,
  });
  return response.data;
}

export async function getCompanyStats(projectId: string): Promise<CompanyStatsResponse> {
  const response = await axiosForBackend.get(
    `/api/restaurants/stats?projectId=${encodeURIComponent(projectId)}`,
  );
  return response.data;
}

export async function updateEmail(
  id: string,
  data: UpdateEmailRequest,
): Promise<Company> {
  const response = await axiosForBackend.patch(`/api/restaurants/${id}/email`, data);
  return response.data;
}

export async function getCompany(id: string): Promise<Company> {
  const response = await axiosForBackend.get(`/api/restaurants/${id}`);
  return response.data;
}

export async function deleteCompany(id: string): Promise<void> {
  await axiosForBackend.delete(`/api/restaurants/${id}`);
}

export async function getDuplicates(projectId: string): Promise<DuplicateCheckResponse> {
  const response = await axiosForBackend.get(
    `/api/restaurants/duplicates?projectId=${encodeURIComponent(projectId)}`,
  );
  return response.data;
}

export async function batchDelete(
  projectId: string,
  ids: string[],
): Promise<{ deleted: number }> {
  const body: BatchDeleteRequest = { ids };
  const response = await axiosForBackend.post(
    `/api/restaurants/batch-delete?projectId=${encodeURIComponent(projectId)}`,
    body,
  );
  return response.data;
}
