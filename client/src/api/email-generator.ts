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

/**
 * Download the .eml file through the authenticated axios client.
 *
 * The endpoint sits behind the JWT guard, so opening `getEmlUrl()` with
 * `window.open` would send a request without the Authorization header and
 * always answer 401. Fetching here (auth header included) and saving the
 * response as a Blob keeps the download working.
 */
export async function downloadEml(id: string): Promise<void> {
  const response = await axiosForBackend.get(getEmlUrl(id), {
    responseType: 'text',
    transformResponse: [(data: unknown) => data],
  });

  const payload = response.data as unknown;
  let content: string;
  let fileName = 'email.eml';

  if (typeof payload === 'string') {
    content = payload;
  } else {
    const data = (payload ?? {}) as {
      emlContent?: string | null;
      fileName?: string | null;
    };
    content = data.emlContent ?? '';
    if (data.fileName) fileName = data.fileName;
  }

  const blob = new Blob([content], { type: 'message/rfc822;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(objectUrl);
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

