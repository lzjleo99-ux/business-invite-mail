import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  Company,
  Restaurant,
  BatchAnalyzeRequest,
} from '@shared/api.interface';
import type { ServerBatchProgress } from '@shared/api.interface';

// --- Legacy Restaurant-named function (backward compatibility) ---

export async function analyzeWebsite(restaurantId: string): Promise<Restaurant> {
  const response = await axiosForBackend.post(`/api/website-analyzer/analyze/${restaurantId}`);
  return response.data;
}

export async function batchAnalyze(
  projectIdOrData: string | BatchAnalyzeRequest,
  maybeCompanyIds?: string[],
  maybeScope?: 'unanalyzed' | 'analyzed' | 'all',
): Promise<{ total: number }> {
  let body: BatchAnalyzeRequest;
  if (typeof projectIdOrData === 'string') {
    // New form: batchAnalyze(projectId, companyIds?)
    body = { projectId: projectIdOrData, companyIds: maybeCompanyIds };
  } else {
    // Legacy form: batchAnalyze({ projectId?, companyIds? })
    body = projectIdOrData;
  }
  if (maybeScope) body.scope = maybeScope;
  const response = await axiosForBackend.post('/api/website-analyzer/batch-analyze', body);
  return response.data;
}

// --- Company-named functions with projectId support ---

export async function analyzeCompany(id: string): Promise<Company> {
  const response = await axiosForBackend.post(`/api/website-analyzer/analyze/${id}`);
  return response.data;
}

export interface EmailRescanSummary {
  scanned: number;
  updated: number;
  added: number;
  errors: number;
  skippedNoWebsite: number;
  changes: Array<{
    id: string;
    name: string;
    from: string | null;
    to: string;
    action: 'updated' | 'added';
  }>;
}

/**
 * 邮箱核验/挖掘：重扫项目内所有公司官网（首页 + 联系页）。
 * 纯 HTTP + 正则，不调 AI；50 站点约 1-2 分钟 —— 超时给足。
 */
export async function rescanEmails(projectId: string): Promise<EmailRescanSummary> {
  const response = await axiosForBackend.post(
    '/api/website-analyzer/rescan-emails',
    { projectId },
    { timeout: 600_000 },
  );
  return response.data;
}

export interface CompanyContact {
  type: 'email' | 'phone';
  value: string;
  isPrimary: boolean;
}

/** 某公司抓到的全部联系方式（多个邮箱/电话都要列出来） */
export async function getCompanyContacts(companyId: string): Promise<CompanyContact[]> {
  const response = await axiosForBackend.get(
    `/api/website-analyzer/contacts/${companyId}`,
  );
  return (response.data?.items ?? []) as CompanyContact[];
}

/** 服务端批量分析进度（批量在服务器后台跑，断网/关页不受影响） */
export async function getAnalyzeBatchStatus(
  projectId: string,
): Promise<ServerBatchProgress[]> {
  const response = await axiosForBackend.get(
    `/api/website-analyzer/batch-status?projectId=${projectId}`,
  );
  return response.data;
}


/** 停止正在跑的服务端批量分析（回收 analyzing 僵尸） */
export async function stopAnalyzeBatch(projectId: string): Promise<{ stopped: boolean; recovered: number }> {
  const response = await axiosForBackend.post('/api/website-analyzer/batch-stop', { projectId });
  return response.data;
}
