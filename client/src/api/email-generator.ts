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
  // 服务端模型调用最长 600s × 3 次尝试（含退避）≈ 30min，客户端等待要比服务端更久，
  // 否则浏览器会先断开，服务端还在跑 → 误判失败。
  const response = await axiosForBackend.post(`/api/email-generator/generate/${restaurantId}`, undefined, {
    timeout: 1_950_000,
  });
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


// --- SMTP direct sending ---

export interface BatchSendSummary {
  eligible: number;
  sent: number;
  failed: number;
  skippedNoEmail: number;
  skippedAlreadySent: number;
  errors: Array<{ name: string; error: string }>;
}

/** 单公司直发：自动收件人/主题/内嵌图，成功后标记「已邮件联系」 */
export async function sendEmail(
  companyId: string,
  lang: 'local' | 'en' = 'local',
  accountId?: string,
  profileId?: string,
): Promise<{ to: string; subject: string }> {
  const q = new URLSearchParams({ lang });
  if (accountId) q.set('accountId', accountId);
  if (profileId) q.set('profileId', profileId);
  const response = await axiosForBackend.post(
    `/api/email-generator/send/${companyId}?${q.toString()}`,
  );
  return response.data;
}

/** 一键发送：项目内「已生成 + 有邮箱 + 未发送」全部经 SMTP 发出，耗时较长 */
export async function batchSendEmails(
  projectId: string,
  lang: 'local' | 'en' = 'local',
  langOverrides: Record<string, 'local' | 'en'> = {},
  /** 只发这些公司；不传 = 整个项目 */
  companyIds?: string[],
  /** 用哪个发信账号；不传 = 默认账号 */
  accountId?: string,
  /** 用哪个发信人档案（签名身份）；不传 = 用户默认档案 */
  profileId?: string,
): Promise<BatchSendSummary> {
  const response = await axiosForBackend.post(
    '/api/email-generator/batch-send',
    { projectId, lang, langOverrides, companyIds, accountId, profileId },
    { timeout: 600_000 },
  );
  return response.data;
}

// --- 邮件往来历史（发信 + 收信） ---

export interface EmailHistoryItem {
  id: string;
  companyId: string | null;
  companyName: string | null;
  projectId: string | null;
  direction: 'outbound' | 'inbound';
  status: 'sent' | 'failed' | 'received' | 'bounce';
  fromAddr: string;
  toAddr: string;
  subject: string;
  snippet: string;
  messageId: string | null;
  error: string | null;
  at: string;
}

export interface EmailHistoryListParams {
  companyId?: string;
  projectId?: string;
  direction?: 'outbound' | 'inbound';
  status?: string;
  search?: string;
  /** 只看某个邮箱的往来 */
  email?: string;
  page?: number;
  pageSize?: number;
}

/** 全局往来记录（往来历史页） */
export async function getEmailHistories(
  params: EmailHistoryListParams,
): Promise<{ items: EmailHistoryItem[]; total: number }> {
  const qs = new URLSearchParams();
  if (params.companyId) qs.set('companyId', params.companyId);
  if (params.projectId) qs.set('projectId', params.projectId);
  if (params.direction) qs.set('direction', params.direction);
  if (params.status) qs.set('status', params.status);
  if (params.search) qs.set('search', params.search);
  if (params.email) qs.set('email', params.email);
  if (params.page) qs.set('page', String(params.page));
  if (params.pageSize) qs.set('pageSize', String(params.pageSize));
  const response = await axiosForBackend.get(`/api/email-generator/histories?${qs.toString()}`);
  return response.data;
}

/** 单条往来详情（含完整正文） */
export interface BounceInfo {
  failedAddress: string | null;
  reason: string | null;
  reasonZh: string | null;
}

export interface EmailHistoryDetail extends EmailHistoryItem {
  bodyText: string;
  /** 仅退信有：解析出的失败地址与原因 */
  bounce?: BounceInfo | null;
}

export async function getEmailHistoryDetail(
  id: string,
): Promise<EmailHistoryDetail> {
  const response = await axiosForBackend.get(
    `/api/email-generator/histories/detail/${id}`,
  );
  return response.data;
}

/** 单公司往来（公司行展开面板） */
export async function getCompanyEmailHistories(
  companyId: string,
): Promise<{ items: EmailHistoryItem[] }> {
  const response = await axiosForBackend.get(`/api/email-generator/histories/${companyId}`);
  return response.data;
}

/** 手动收取一次收件箱 */
export async function pollInbox(): Promise<{
  fetched: number;
  saved: number;
  lastUid: number;
  error?: string;
}> {
  const response = await axiosForBackend.post('/api/email-generator/inbox-poll', {}, { timeout: 180_000 });
  return response.data;
}

// --- 号码注册检测（WhatsApp / Viber）---

export interface MessengerStatus {
  companyId: string;
  phone: string;
  whatsapp: 'yes' | 'no' | 'unknown';
  viber: 'yes' | 'no' | 'unknown';
}

export interface MessengerBatchSummary {
  total: number;
  whatsappYes: number;
  whatsappNo: number;
  unknown: number;
}

/** 批量检测项目内所有有号码的公司 */
export async function checkMessengerBatch(
  projectId: string,
): Promise<MessengerBatchSummary> {
  const response = await axiosForBackend.post(
    `/api/email-generator/messenger-check-batch/${projectId}`,
    {},
    { timeout: 300_000 },
  );
  return response.data;
}

/** 读取已检测结果 */
export async function listMessengerStatus(
  projectId: string,
): Promise<MessengerStatus[]> {
  const response = await axiosForBackend.get(
    `/api/email-generator/messenger-check/${projectId}`,
  );
  return response.data.items ?? [];
}
