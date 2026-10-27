/**
 * 从后端错误里抽出**具体原因**（平台错误格式 {error:{message,stack}} 或 axios 错误），
 * 让用户看到「模型没 token / 网络超时 / 无权限」而不是笼统的"稍后重试"。
 */
export function errMessage(err: unknown, fallback = '请求失败'): string {
  if (!err) return fallback;
  const e = err as { response?: { data?: { error?: { message?: string } | string; message?: string } }; message?: string };
  const data = e.response?.data;
  if (data) {
    if (typeof data.error === 'object' && data.error?.message) return data.error.message;
    if (typeof data.error === 'string') return data.error;
    if (typeof data.message === 'string') return data.message;
  }
  if (e.message && !/network error|failed with status/i.test(e.message)) return e.message;
  if (e.message) return `${fallback}（${e.message}）`;
  return fallback;
}
