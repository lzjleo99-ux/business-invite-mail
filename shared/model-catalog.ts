/**
 * 模型目录：给设置页的下拉用，同时给后端判断"这个模型该怎么调"用。
 *
 * 为什么要单独一份静态目录：
 * - 之前下拉只列当前 API 返回的模型，换一家 Base URL 就只剩零星几个，且没有厂商分组。
 * - 推理模型（o1/o3/o4、deepseek-reasoner、GLM-5.x、GPT-5 thinking、Claude adaptive thinking）
 *   和普通模型的**请求参数不一样**：不接受自定义 temperature，也不接受 max_tokens。
 *   之前只有 GLM-5.x 被特判，换个模型就又踩坑。
 *
 * 清单按 2026-10 的公开文档整理。模型迭代很快，这里漏了某个新模型不影响使用——
 * 设置页会把当前 API 返回的模型合并进来，仍可手填。
 */

export interface CatalogModel {
  id: string;
  /** 下拉里显示的说明（能力/定位），可省 */
  note?: string;
  /** 推理模型：不要传 temperature，也不要传 max_tokens */
  reasoning?: boolean;
}

export interface CatalogGroup {
  company: string;
  models: CatalogModel[];
}

export const MODEL_CATALOG: CatalogGroup[] = [
  {
    company: 'OpenAI',
    models: [
      { id: 'gpt-5.5', note: 'latest flagship' },
      { id: 'gpt-5.4', note: 'flagship' },
      { id: 'gpt-5.4-mini', note: 'cheap flagship' },
      { id: 'gpt-5.2', note: 'previous flagship' },
      { id: 'gpt-5.2-pro', note: 'max quality' },
      { id: 'gpt-5.1', note: '' },
      { id: 'gpt-5', note: '' },
      { id: 'gpt-5-pro', note: 'max quality' },
      { id: 'gpt-5-mini', note: 'cost-effective' },
      { id: 'gpt-5-nano', note: 'high volume' },
      { id: 'gpt-4.1', note: 'balanced' },
      { id: 'gpt-4.1-mini', note: 'budget' },
      { id: 'gpt-4.1-nano', note: 'ultra-low cost' },
      { id: 'gpt-4o', note: 'multimodal' },
      { id: 'gpt-4o-mini', note: 'fast, cheap' },
      { id: 'o4-mini', note: 'reasoning', reasoning: true },
      { id: 'o3', note: 'reasoning', reasoning: true },
      { id: 'o3-pro', note: 'reasoning, max', reasoning: true },
      { id: 'o3-mini', note: 'reasoning, cheap', reasoning: true },
      { id: 'o1', note: 'reasoning', reasoning: true },
      { id: 'o1-pro', note: 'reasoning, research', reasoning: true },
      { id: 'o1-mini', note: 'reasoning, budget', reasoning: true },
    ],
  },
  {
    company: 'Anthropic',
    models: [
      { id: 'claude-fable-5-1', note: 'long-horizon agents', reasoning: true },
      { id: 'claude-opus-5-5', note: 'agentic coding', reasoning: true },
      { id: 'claude-sonnet-5-5', note: 'speed + intelligence', reasoning: true },
      { id: 'claude-haiku-4-5-20251001', note: 'fastest' },
      { id: 'claude-opus-4-8', note: '', reasoning: true },
      { id: 'claude-sonnet-4-6', note: 'high volume', reasoning: true },
      { id: 'claude-sonnet-4-5', note: 'production', reasoning: true },
    ],
  },
  {
    company: 'Google',
    models: [
      { id: 'gemini-3-pro', note: 'latest flagship' },
      { id: 'gemini-2.5-pro', note: '' },
      { id: 'gemini-2.5-flash', note: 'fast, cheap' },
      { id: 'gemini-2.0-flash', note: '' },
      { id: 'gemini-1.5-pro', note: '' },
      { id: 'gemini-1.5-flash', note: '' },
    ],
  },
  {
    company: 'DeepSeek',
    models: [
      { id: 'deepseek-chat', note: 'general' },
      { id: 'deepseek-reasoner', note: 'reasoning', reasoning: true },
    ],
  },
  {
    company: 'Zhipu AI (GLM)',
    models: [
      { id: 'glm-5.2', note: 'reasoning', reasoning: true },
      { id: 'glm-4.6', note: '' },
      { id: 'glm-4.5', note: '' },
      { id: 'glm-4.5-air', note: 'cheap' },
      { id: 'glm-4-plus', note: '' },
      { id: 'glm-4-air', note: 'cheap' },
      { id: 'glm-4', note: '' },
    ],
  },
  {
    company: 'Alibaba (Qwen)',
    models: [
      { id: 'qwen3-max', note: 'flagship' },
      { id: 'qwen-max', note: '' },
      { id: 'qwen-plus', note: '' },
      { id: 'qwen-turbo', note: 'fast, cheap' },
      { id: 'qwen-long', note: 'long context' },
    ],
  },
  {
    company: 'Moonshot (Kimi)',
    models: [
      { id: 'kimi-k2', note: 'latest' },
      { id: 'moonshot-v1-128k', note: 'long context' },
      { id: 'moonshot-v1-32k', note: '' },
      { id: 'moonshot-v1-8k', note: '' },
    ],
  },
  {
    company: 'xAI',
    models: [
      { id: 'grok-4', note: 'latest' },
      { id: 'grok-3', note: '' },
      { id: 'grok-3-mini', note: 'cheap' },
    ],
  },
  {
    company: 'MiniMax',
    models: [
      { id: 'minimax-m2', note: 'agent' },
      { id: 'abab7-chat', note: '' },
    ],
  },
  {
    company: 'ByteDance (Doubao)',
    models: [
      { id: 'doubao-pro-256k', note: 'long context' },
      { id: 'doubao-pro-128k', note: '' },
      { id: 'doubao-pro-32k', note: '' },
      { id: 'doubao-lite-128k', note: 'cheap' },
    ],
  },
];

/** 聚合渠道常带厂商前缀（TPK/GLM-5.2、azure/gpt-4o…），判断时只看到最后一段 */
function lastSegment(model: string): string {
  const parts = model.split('/');
  return (parts[parts.length - 1] ?? model).toLowerCase();
}

/**
 * 是不是推理模型。
 * 推理模型的硬限制：不接受自定义 temperature（只能 1），不接受 max_tokens。
 * 之前只有 GLM-5.x 被特判；o1/o3 系列、deepseek-reasoner 都会 400。
 */
export function isReasoningModel(model: string): boolean {
  const m = lastSegment(model);
  if (!m) return false;
  // OpenAI o 系列
  if (/^o[1-9]\b/.test(m) || /^o[1-9]-/.test(m)) return true;
  // GPT-5 的 thinking/pro 变体
  if (/^gpt-5.*(thinking|pro)/.test(m)) return true;
  // DeepSeek
  if (m.startsWith('deepseek-reasoner')) return true;
  // GLM 5.x 是推理模型；4.x 不是
  if (/^glm-5(\.|$)/.test(m)) return true;
  // Claude 4.6+ / Fable 是 adaptive thinking（默认开启）
  if (/^claude-(fable|opus-5|sonnet-5|opus-4-[6-9]|sonnet-4-[6-9])/.test(m)) return true;
  return false;
}

export interface ChatBodyInput {
  model: string;
  messages: Array<{ role: string; content: string }>;
  /** 用户设的 temperature；推理模型会忽略 */
  temperature?: number | null;
  /** 需要 JSON 输出时传 'json_object' */
  jsonMode?: boolean;
  /** 普通模型可限制输出长度；推理模型一律不传 */
  maxTokens?: number;
}

/**
 * 按模型家族构造 /chat/completions 请求体。
 *
 * 这是"选完模型后台要怎么变"的唯一入口——之前 5 处各拼各的，
 * 加个新模型家族就得改 5 个地方，漏一处就静默用错参数。
 */
export function buildChatBody(input: ChatBodyInput): Record<string, unknown> {
  const reasoning = isReasoningModel(input.model);
  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
  };

  if (reasoning) {
    // 推理模型：temperature 只能取默认值 1，max_tokens 会直接被拒。
    // 用 max_completion_tokens 表达"别太长"的意图（不支持的实现会忽略未知字段）。
    if (input.maxTokens != null) body.max_completion_tokens = input.maxTokens;
  } else {
    body.temperature = input.temperature ?? 0.7;
    if (input.maxTokens != null) body.max_tokens = input.maxTokens;
  }

  if (input.jsonMode) body.response_format = { type: 'json_object' };
  return body;
}

/** 设置页下拉用：目录 + 当前 API 返回的模型合并去重 */
export interface MergedModel {
  id: string;
  note: string;
  reasoning: boolean;
  /** 来自当前 API（而非内置目录） */
  fromApi: boolean;
}

export function mergeModelLists(
  apiModels: Array<{ id: string; description?: string }>,
): { company: string; models: MergedModel[] }[] {
  const groups: { company: string; models: MergedModel[] }[] = MODEL_CATALOG.map((g) => ({
    company: g.company,
    models: g.models.map((m) => ({
      id: m.id,
      note: m.note ?? '',
      reasoning: m.reasoning === true || isReasoningModel(m.id),
      fromApi: false,
    })),
  }));

  const seen = new Set(groups.flatMap((g) => g.models.map((m) => m.id.toLowerCase())));
  const extra: MergedModel[] = [];
  for (const m of apiModels) {
    if (!m.id || seen.has(m.id.toLowerCase())) continue;
    seen.add(m.id.toLowerCase());
    extra.push({
      id: m.id,
      note: m.description ?? '',
      reasoning: isReasoningModel(m.id),
      fromApi: true,
    });
  }
  if (extra.length > 0) {
    groups.push({ company: 'From your API', models: extra });
  }
  return groups;
}
