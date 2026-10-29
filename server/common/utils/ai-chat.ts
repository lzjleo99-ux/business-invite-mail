import axios, { type AxiosResponse } from 'axios';
import { Logger } from '@nestjs/common';

/**
 * OpenAI 兼容 /chat/completions 统一调用入口，带"参数不兼容自动适配"。
 *
 * 背景（2026-10-29）：用户把模型切到 OpenAI 官方 gpt-5.4 后，"测试连接"报
 * `HTTP 400: Unsupported parameter: 'max_tokens' is not supported with this
 * model. Use 'max_completion_tokens' instead.` —— gpt-5 / o 系列不接受
 * `max_tokens` 与自定义 `temperature`，而中转服务和旧模型恰恰需要它们。
 * 各家行为不一致，没法在发请求前判断，所以做成 **400 点名参数 → 调整 → 重试**：
 * - `'max_tokens' is not supported` → 换成 `max_completion_tokens`（原值照搬）
 * - `'temperature' is not supported` / `'top_p' ...` → 直接删掉该参数
 * - 其他 400 / 非 2xx：原样抛出（错误提示与原来一致）
 *
 * 所有走模型的地方（测试连接、邮件生成、图片描述、网站分析）都必须经过这里，
 * 别再直接 axios.post。
 */

const aiChatLogger = new Logger('AiChat');

export interface AiChatOptions {
  /** 请求超时（毫秒） */
  timeout?: number;
  /** 日志前缀（如 'email-generator'），用于排查 */
  label?: string;
}

/** 从 400 的报错信息里推断怎么调整 body；返回 null = 没法自动修 */
function adjustBodyForUnsupportedParam(
  body: Record<string, unknown>,
  message: string,
): Record<string, unknown> | null {
  const next: Record<string, unknown> = { ...body };
  let changed = false;

  const unsupported = message.match(/'(\w+)' is not supported/i)
    ?? message.match(/Unsupported parameter:\s*'(\w+)'/i);
  if (unsupported) {
    const param = unsupported[1];
    if (param === 'max_tokens' && 'max_tokens' in next) {
      // 新模型用 max_completion_tokens；部分模型有最小值限制，太小的值会被拒
      if (next.max_completion_tokens === undefined) {
        next.max_completion_tokens = Math.max(Number(next.max_tokens) || 0, 256);
      }
      delete next.max_tokens;
      changed = true;
    } else if (param in next) {
      delete next[param];
      changed = true;
    }
  }

  if (!changed && /use\s+'max_completion_tokens'/i.test(message) && 'max_tokens' in next) {
    next.max_completion_tokens = Math.max(Number(next.max_tokens) || 0, 256);
    delete next.max_tokens;
    changed = true;
  }

  return changed ? next : null;
}

/** 参数名 → 用户能看懂的说明（自动适配时提示，避免"为什么结果不一样"的疑惑） */
export function describeAdjustedParams(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const notes: string[] = [];
  if ('max_tokens' in before && !('max_tokens' in after)) {
    notes.push('max_tokens → max_completion_tokens（该模型的新参数名）');
  }
  for (const key of ['temperature', 'top_p', 'presence_penalty', 'frequency_penalty']) {
    if (key in before && !(key in after)) notes.push(`${key} 已按模型要求移除`);
  }
  return notes;
}

/** 调 /chat/completions；非 2xx 抛 axios 异常（与原行为一致），可自动修的 400 内部重试 */
export async function postChatCompletions(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  opts: AiChatOptions = {},
): Promise<AxiosResponse> {
  let current = { ...body };
  const maxAdjust = 3;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await axios.post(url, current, {
        headers,
        timeout: opts.timeout ?? 120_000,
      });
    } catch (err: unknown) {
      const fixable =
        axios.isAxiosError(err)
        && err.response?.status === 400
        && attempt < maxAdjust;
      if (!fixable) throw err;
      const message: string =
        (err.response?.data as { error?: { message?: string } } | undefined)?.error?.message
        || String(err.response?.data ?? '');
      const adjusted = adjustBodyForUnsupportedParam(current, message);
      if (!adjusted) throw err;
      const notes = describeAdjustedParams(current, adjusted);
      aiChatLogger.warn(
        `[${opts.label ?? 'ai-chat'}] 模型不接受请求参数，已自动适配后重试：${notes.join('；')}`
        + `（原始报错：${message.slice(0, 160)}）`,
      );
      current = adjusted;
    }
  }
}
