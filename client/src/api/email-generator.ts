import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  GeneratedEmail,
  BatchGenerateRequest,
  WhatsAppInfo,
  BatchWhatsAppRequest,
} from '@shared/api.interface';

export interface ComposeEmailData {
  recipientEmail: string;
  subject: string;
  body: string;
  subjectLocal: string;
  bodyLocal: string;
  languageCode: string;
  companyName: string;
}

export interface SaveComposeData {
  subject: string;
  body: string;
  subjectLocal: string;
  bodyLocal: string;
  language: string;
}

// --- Legacy Restaurant-named function (backward compatibility) ---

export async function generateEmail(restaurantId: string): Promise<GeneratedEmail> {
  const response = await axiosForBackend.post(`/api/email-generator/generate/${restaurantId}`);
  return response.data;
}

export async function batchGenerate(
  projectIdOrData: string | BatchGenerateRequest,
  maybeCompanyIds?: string[],
): Promise<{ total: number }> {
  let body: BatchGenerateRequest;
  if (typeof projectIdOrData === 'string') {
    // New form: batchGenerate(projectId, companyIds?)
    body = { projectId: projectIdOrData, companyIds: maybeCompanyIds };
  } else {
    // Legacy form: batchGenerate({ projectId?, companyIds? })
    body = projectIdOrData;
  }
  const response = await axiosForBackend.post('/api/email-generator/batch-generate', body);
  return response.data;
}

// --- Additional company-named helpers ---

export function getEmlUrl(id: string): string {
  return `/api/email-generator/eml/${id}`;
}

export async function getWhatsAppInfo(id: string): Promise<WhatsAppInfo> {
  const response = await axiosForBackend.get(`/api/email-generator/whatsapp/${id}`);
  return response.data;
}

export async function generateWhatsApp(id: string): Promise<WhatsAppInfo> {
  const response = await axiosForBackend.post(`/api/email-generator/whatsapp/${id}`);
  return response.data;
}

export async function batchWhatsApp(
  projectId: string,
): Promise<{ total: number }> {
  const body: BatchWhatsAppRequest = { projectId };
  const response = await axiosForBackend.post('/api/email-generator/batch-whatsapp', body);
  return response.data;
}

// --- Compose page ---

export async function getComposeData(companyId: string): Promise<ComposeEmailData> {
  const response = await axiosForBackend.get(`/api/email-generator/compose/${companyId}`);
  return response.data;
}

export async function saveComposeData(
  companyId: string,
  data: SaveComposeData,
): Promise<void> {
  await axiosForBackend.patch(`/api/email-generator/compose/${companyId}`, data);
}

