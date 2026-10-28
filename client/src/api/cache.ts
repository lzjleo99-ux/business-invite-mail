import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';

/**
 * 缓存维护接口（首页"清理缓存"按钮）。
 * 后端只清理本应用的可再生缓存（孤儿图片描述、过期 AI 描述缓存、过期验证码、
 * 内存 transporter 缓存），**不影响平台/系统级缓存**，也不删用户数据。
 */

export interface CacheCleanupStats {
  orphanImageDescriptions: number;
  staleAiDescriptions: number;
  expiredResetCodes: number;
  orphanAttachments: number;
  orphanMessengerRows: number;
  transporterCacheCleared: boolean;
  total: number;
}

export interface CacheCleanupResult {
  trigger: 'manual' | 'scheduled';
  at: string;
  durationMs: number;
  stats: CacheCleanupStats;
}

export interface CacheStatus {
  lastRun: CacheCleanupResult | null;
  nextRunAt: string | null;
  intervalHours: number;
}

/** 手动清理缓存 */
export async function clearCache(): Promise<CacheCleanupResult> {
  const response = await axiosForBackend.post('/api/admin/cache/clear', {}, { timeout: 120_000 });
  return response.data;
}

/** 缓存状态：上次清理 + 下次计划 */
export async function getCacheStatus(): Promise<CacheStatus> {
  const response = await axiosForBackend.get('/api/admin/cache/status');
  return response.data;
}
