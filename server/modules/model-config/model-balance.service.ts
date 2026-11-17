import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

/**
 * 模型额度 / 剩余 Token 检查（设置页手动触发）。
 *
 * 各家供应商的余额接口不统一，按优先级逐一探测，全部失败也不报错，
 * 而是返回明确说明「该供应商不公开余额查询」，绝不编造数字：
 *  - One-API / New-API 中转（aixapex 等）：/api/user/self、/api/status
 *    → data.quota / used_quota（1 元 = 500000 quota，按常见换算展示）
 *  - OpenAI 官方：/v1/dashboard/billing/subscription → hard_limit_usd；
 *    /v1/dashboard/billing/usage → total_usage（美元 / 100）
 *  - Anthropic / 其他：通常没有公开的余额端点，会走到「不支持」分支
 *
 * 不返回 API Key、不回传原始响应体，避免密钥或账户详情泄漏。
 */

export interface ModelBalance {
  ok: boolean;
  /** key 是否有效（余额端点通常也要求鉴权，200 即说明 key 可用） */
  keyValid: boolean;
  /** 识别到的供应商类型 */
  provider: string;
  /** 有数据时才有；没有就是 undefined（UI 不显示假数字） */
  remaining?: number;
  total?: number;
  used?: number;
  unit?: string;
  /** 用户可读的结论 */
  message: string;
  /** 明细说明（为什么没查到） */
  detail?: string;
  checkedAt: string;
}

interface ProbingConfig {
  baseUrl: string;
  apiKey: string;
  modelName: string;
}

interface EndpointSpec {
  name: string;
  path: string;
  parse: (data: unknown) => Omit<ModelBalance, 'ok' | 'keyValid' | 'provider' | 'message' | 'checkedAt'> & { message: string } | null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

/** One-API 风格：quota 单位 1元=500000 */
function parseOneApi(data: unknown): { remaining?: number; total?: number; used?: number; unit?: string; message: string } | null {
  const d = data as { data?: Record<string, unknown> } | Record<string, unknown>;
  const obj = ((d as { data?: Record<string, unknown> }).data ?? d) as Record<string, unknown>;
  const quota = num(obj.quota ?? obj.totalQuota ?? obj.remainingQuota);
  const usedRaw = num(obj.used_quota ?? obj.usedQuota);
  if (quota === null && usedRaw === null) return null;
  // quota 是剩余额度；used 是已用；总量 = 剩余 + 已用
  const remaining = quota === null ? undefined : quota / 500000;
  const used = usedRaw === null ? undefined : usedRaw / 500000;
  return {
    remaining,
    used,
    total: remaining !== undefined && used !== undefined ? remaining + used : undefined,
    unit: '元',
    message: '已读取中转平台额度（One-API / New-API）',
  };
}

/** OpenAI 官方账单端点 */
function parseOpenAiSubscription(data: unknown): { total?: number; unit?: string; message: string } | null {
  const d = data as Record<string, unknown>;
  const limit = num(d.hard_limit_usd);
  if (limit === null) return null;
  return { total: limit, unit: '美元', message: '已读取 OpenAI 订阅额度上限（当前用量需 billing 权限）' };
}

function parseOpenAiUsage(data: unknown): { used?: number; unit?: string; message: string } | null {
  const d = data as Record<string, unknown>;
  const usage = num(d.total_usage);
  if (usage === null) return null;
  return { used: usage / 100, unit: '美元', message: '已读取 OpenAI 当期用量' };
}

@Injectable()
export class ModelBalanceService {
  private readonly logger = new Logger(ModelBalanceService.name);

  /**
   * 查询专用令牌服务（如 http://61.49.87.124:3667 前端对应的 API :2657）。
   * 接口：GET {TOKEN_QUERY_URL}/api/usage/token/，Bearer <apiKey>
   * 返回：total_granted / total_used / total_available / unlimited_quota /
   *       expires_at / name —— 网站原样展示，不换算、不编造。
   */
  private async queryTokenService(
    queryUrl: string,
    apiKey: string,
    checkedAt: string,
  ): Promise<ModelBalance | null> {
    const roots = [queryUrl.replace(/\/+$/, ''), queryUrl.replace(/\/+$/, '').replace(/:3667$/, ':2657')]
      .filter((v, i, a) => v && a.indexOf(v) === i);
    for (const root of roots) {
      try {
        const resp = await axios.get(
          `${root}/api/usage/token/`,
          {
            headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
            timeout: 8_000,
            validateStatus: () => true,
          },
        );
        if (resp.status !== 200) continue;
        const d = resp.data as {
          code?: boolean; message?: string;
          data?: {
            total_granted?: number; total_used?: number; total_available?: number;
            unlimited_quota?: boolean; expires_at?: number; name?: string;
            model_limits_enabled?: boolean; model_limits?: unknown;
          };
        };
        if (!d?.code || !d.data) continue;
        const info = d.data;
        const exhausted = !info.unlimited_quota
          && typeof info.total_available === 'number'
          && info.total_available <= 0;
        return {
          ok: true,
          keyValid: true,
          provider: 'token-query-service',
          total: info.total_granted,
          used: info.total_used,
          remaining: info.unlimited_quota ? undefined : info.total_available,
          unit: '额度',
          message: exhausted
            ? `${info.name || '该令牌'} 额度已用完（剩余 ${info.total_available}），请充值后再使用`
            : (d.message || '已读取令牌查询服务的数据'),
          detail: [
            info.name ? `令牌：${info.name}` : '',
            info.unlimited_quota ? '不限额' : '',
            info.expires_at
              ? `到期：${new Date(info.expires_at * 1000).toLocaleString('zh-CN')}`
              : '',
          ].filter(Boolean).join('；'),
          checkedAt,
        };
      } catch (err: unknown) {
        this.logger.warn(
          `令牌查询服务不可用（${root}）：${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return null;
  }

  /** 由 controller 传入已解析好的配置（apiKey 从表单或用户行取，绝不回显） */
  async check(config: ProbingConfig): Promise<ModelBalance> {
    const checkedAt = new Date().toISOString();

    // 优先用专用的「令牌查询」服务（用户在设置里配 TOKEN_QUERY_URL），
    // 它返回什么字段就原样展示什么字段——不再靠猜测各家供应商的账单接口。
    // 默认就是用户在用的令牌查询站；环境变量可覆盖。
    const queryUrl = process.env.TOKEN_QUERY_URL?.trim() || 'http://61.49.87.124:3667';
    if (queryUrl && config.apiKey) {
      const queried = await this.queryTokenService(queryUrl, config.apiKey, checkedAt);
      if (queried) return queried;
    }

    const base = (config.baseUrl || '').replace(/\/+$/, '');
    if (!base || !config.apiKey) {
      return {
        ok: false, keyValid: false, provider: 'unknown', checkedAt,
        message: '请先配置 API Base URL 和 API Key',
      };
    }

    const headers = {
      Authorization: `Bearer ${config.apiKey}`,
      Accept: 'application/json',
      'User-Agent': 'EmailAssistant-BalanceCheck/1.0',
    };

    // 同一 base URL 上去掉 /v1 再试一次（中转站经常把管理接口放在根路径）
    const roots = [base, base.replace(/\/v1$/i, '')].filter(
      (v, i, a) => v && a.indexOf(v) === i,
    );

    const specs: EndpointSpec[] = [
      { name: 'one-api-self', path: '/api/user/self', parse: parseOneApi },
      { name: 'one-api-status', path: '/api/status', parse: parseOneApi },
      { name: 'openai-subscription', path: '/v1/dashboard/billing/subscription', parse: parseOpenAiSubscription },
      { name: 'openai-usage', path: '/v1/dashboard/billing/usage', parse: parseOpenAiUsage },
    ];

    const errors: string[] = [];
    for (const root of roots) {
      for (const spec of specs) {
        const url = `${root}${spec.path}`;
        try {
          const resp = await axios.get(url, { headers, timeout: 6000, validateStatus: () => true });
          if (resp.status >= 200 && resp.status < 300) {
            const parsed = spec.parse(resp.data);
            if (parsed) {
              return {
                ok: true,
                keyValid: true,
                provider: spec.name,
                ...parsed,
                checkedAt,
              };
            }
            // 200 但字段不匹配：说明 key 有效，只是这个端点不返回额度
            return {
              ok: true,
              keyValid: true,
              provider: spec.name,
              checkedAt,
              message: 'API Key 有效，但该接口未提供可识别的额度字段',
            };
          }
          if (resp.status === 401 || resp.status === 403) {
            errors.push(`${spec.name}: HTTP ${resp.status}（该端点需要管理员权限或不适用）`);
          }
        } catch (err: unknown) {
          errors.push(
            `${spec.name}: ${err instanceof Error && axios.isAxiosError(err) && err.code
              ? err.code
              : err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    // 所有余额端点都不可用：再做一次极小的模型调用，至少确认 key 能不能用
    const keyValid = await this.probeModel(config, headers);
    this.logger.warn(`余额探测未取到数据：${errors.slice(0, 4).join(' | ')}`);
    return {
      ok: true,
      keyValid,
      provider: 'unknown',
      checkedAt,
      message: keyValid
        ? 'API Key 可用，但该供应商未提供公开的余额查询接口'
        : 'API Key 不可用，请检查密钥是否填对或已过期',
      detail: errors.slice(0, 4).join('；'),
    };
  }

  /** 用 max_tokens=1 的最小请求验证 key；不算入余额数字，只判定有效性 */
  private async probeModel(config: ProbingConfig, headers: Record<string, string>): Promise<boolean> {
    const base = (config.baseUrl || '').replace(/\/+$/, '');
    try {
      const resp = await axios.post(
        `${base}/chat/completions`,
        {
          model: config.modelName,
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1,
          temperature: 0,
        },
        { headers, timeout: 8000, validateStatus: () => true },
      );
      if (resp.status >= 200 && resp.status < 300) return true;
      // 400 参数不兼容（gpt-5 等）也算 key 有效——错误来自参数而非鉴权
      if (resp.status === 400) return true;
      return false;
    } catch {
      return false;
    }
  }
}
