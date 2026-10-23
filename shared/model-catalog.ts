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

/**
 * 供应商模板（借鉴 ZCode 的 Provider 设计）：
 * 选哪个模型，就用**那家公司自己的**端点和取 key 地址——
 * 不能拿一家聚合渠道的 baseURL 去调所有厂商的模型。
 */
export interface ProviderPreset {
  /** 官方 OpenAI 兼容端点（含 /v1 之类的版本段） */
  baseUrl: string;
  /** 去哪里申请 API Key */
  apiKeyUrl?: string;
}

export interface CatalogGroup extends ProviderPreset {
  company: string;
  models: CatalogModel[];
}

export const MODEL_CATALOG: CatalogGroup[] = [
  {
    company: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
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
    baseUrl: 'https://api.anthropic.com/v1',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
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
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKeyUrl: 'https://aistudio.google.com/app/apikey',
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
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    models: [
      { id: 'deepseek-chat', note: 'general' },
      { id: 'deepseek-reasoner', note: 'reasoning', reasoning: true },
    ],
  },
  {
    company: 'Zhipu AI (GLM)',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
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
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyUrl: 'https://bailian.console.aliyun.com/?apiKey=1#/api-key',
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
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKeyUrl: 'https://platform.moonshot.cn/console/api-keys',
    models: [
      { id: 'kimi-k2', note: 'latest' },
      { id: 'moonshot-v1-128k', note: 'long context' },
      { id: 'moonshot-v1-32k', note: '' },
      { id: 'moonshot-v1-8k', note: '' },
    ],
  },
  {
    company: 'xAI',
    baseUrl: 'https://api.x.ai/v1',
    apiKeyUrl: 'https://console.x.ai',
    models: [
      { id: 'grok-4', note: 'latest' },
      { id: 'grok-3', note: '' },
      { id: 'grok-3-mini', note: 'cheap' },
    ],
  },
  {
    company: 'MiniMax',
    baseUrl: 'https://api.minimaxi.com/v1',
    apiKeyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    models: [
      { id: 'minimax-m2', note: 'agent' },
      { id: 'abab7-chat', note: '' },
    ],
  },
  {
    company: 'ByteDance (Doubao)',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKeyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
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
 * 模型家族。**参数能不能传，完全由家族决定**，所以先分类再构造请求体。
 *
 * 各家族的硬约束（2026-10 核对自厂商文档）：
 * - openai-reasoning（o1/o3/o4、gpt-5 thinking/pro）：
 *     拒绝 temperature / top_p / penalties / max_tokens。
 *     认 max_completion_tokens + reasoning_effort(low|medium|high)。
 * - anthropic：max_tokens **必填**；temperature 范围 **0~1**（不是 0~2）。
 * - deepseek-reasoner / glm-reasoning：temperature 和 max_tokens 都不吃。
 * - qwen / gemini / 其他 OpenAI 兼容：temperature + max_tokens 都吃。
 */
export type ModelFamily =
  | 'openai-reasoning'
  | 'anthropic'
  | 'deepseek-reasoning'
  | 'glm-reasoning'
  | 'qwen'
  | 'openai'
  | 'generic';

export function detectFamily(model: string): ModelFamily {
  const m = lastSegment(model);
  if (!m) return 'generic';
  if (/^claude-/.test(m)) return 'anthropic';
  if (m.startsWith('deepseek-reasoner')) return 'deepseek-reasoning';
  if (/^glm-5(\.|$)/.test(m)) return 'glm-reasoning';
  if (/^qwen/.test(m)) return 'qwen';
  if (/^o[1-9]\b/.test(m) || /^o[1-9]-/.test(m)) return 'openai-reasoning';
  if (/^gpt-5.*(thinking|pro)/.test(m)) return 'openai-reasoning';
  return 'openai';
}

/**
 * 是不是推理模型（UI 用来提示"Temperature 不适用"）。
 * 注意 anthropic 的 adaptive thinking 默认开启，但对 temperature 仍然接受，
 * 所以这里**不把 Claude 算作推理模型**——它只是 max_tokens 必填、temperature 要收窄。
 */
export function isReasoningModel(model: string): boolean {
  const f = detectFamily(model);
  return (
    f === 'openai-reasoning' || f === 'deepseek-reasoning' || f === 'glm-reasoning'
  );
}

/**
 * 把用户的 temperature 意图翻译成推理模型认的 reasoning_effort。
 * temperature 低 = 要确定/严谨 → 多想想（high）；
 * temperature 高 = 要发散/多样 → 少想（low）。
 * 只用 low/medium/high：o 系列只认这三个，GPT-5 额外的 none/minimal/xhigh 不通用。
 */
function temperatureToEffort(temperature: number | null | undefined): 'low' | 'medium' | 'high' {
  if (temperature == null) return 'medium';
  if (temperature <= 0.3) return 'high';
  if (temperature <= 0.7) return 'medium';
  return 'low';
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export interface ChatBodyInput {
  model: string;
  messages: Array<{ role: string; content: string }>;
  /** 用户设的 temperature；推理家族会翻译成别的参数 */
  temperature?: number | null;
  /** 需要 JSON 输出时传 'json_object' */
  jsonMode?: boolean;
  /** 输出上限。anthropic 必填，不给就取 DEFAULT_MAX_TOKENS */
  maxTokens?: number;
}

/** anthropic 的 max_tokens 是必填项，调用方没给时的默认值 */
const DEFAULT_MAX_TOKENS = 4096;

/**
 * 按模型家族构造 /chat/completions 请求体。
 *
 * 这是"选完模型后台要怎么变"的唯一入口——之前 5 处各拼各的，
 * 加个新模型家族就得改 5 个地方，漏一处就静默用错参数。
 *
 * 关于"最小长度"：**这些 API 都没有 min_tokens / min_output_tokens 参数**
 * （OpenAI 帮助中心明确说"There is no minimum tokens setting"）。
 * 要控制下限只能在 prompt 里写清楚，这里不造一个不存在的参数。
 */
export function buildChatBody(input: ChatBodyInput): Record<string, unknown> {
  const family = detectFamily(input.model);
  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
  };

  switch (family) {
    case 'openai-reasoning': {
      // 不传 temperature（只能取默认值 1，传了直接 400）。
      // 用户的温度意图翻译成 reasoning_effort；长度用 max_completion_tokens。
      body.reasoning_effort = temperatureToEffort(input.temperature);
      if (input.maxTokens != null) body.max_completion_tokens = input.maxTokens;
      break;
    }
    case 'anthropic': {
      // temperature 收窄到 0~1（官方范围；传 1.5 会 400）
      body.temperature = clamp(input.temperature ?? 0.7, 0, 1);
      // max_tokens 必填
      body.max_tokens = input.maxTokens ?? DEFAULT_MAX_TOKENS;
      break;
    }
    case 'deepseek-reasoning':
    case 'glm-reasoning': {
      // 两个都不吃，传了就是 400。意图同样翻译成思考预算类参数没有通用字段，
      // 这里只能不传（调用方的 prompt 已经说明了输出要求）。
      break;
    }
    case 'qwen': {
      body.temperature = clamp(input.temperature ?? 0.7, 0, 2);
      if (input.maxTokens != null) body.max_tokens = input.maxTokens;
      break;
    }
    default: {
      body.temperature = clamp(input.temperature ?? 0.7, 0, 2);
      if (input.maxTokens != null) body.max_tokens = input.maxTokens;
      break;
    }
  }

  if (input.jsonMode) body.response_format = { type: 'json_object' };
  return body;
}

/** 按模型找供应商模板。**全字匹配，不剥前缀**：带前缀的 ID（TPK/GLM-5.2）
 *  只在聚合渠道有效，发给厂商官方端点会 404——这种保持用户现有地址。
 *  （isReasoningModel 才剥前缀：那是模型固有能力，跟走哪家渠道无关。） */
export function findProviderByModel(model: string): ProviderPreset | null {
  const lower = model.toLowerCase();
  const hit = MODEL_CATALOG.find((g) =>
    g.models.some((m) => m.id.toLowerCase() === lower),
  );
  if (hit) return { baseUrl: hit.baseUrl, apiKeyUrl: hit.apiKeyUrl };
  return null;
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
): (CatalogGroup & { models: MergedModel[] })[] {
  const groups: (CatalogGroup & { models: MergedModel[] })[] = MODEL_CATALOG.map((g) => ({
    company: g.company,
    baseUrl: g.baseUrl,
    apiKeyUrl: g.apiKeyUrl,
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
    // 聚合渠道/未登记厂商：没有官方端点可填，保持用户现有配置
    groups.push({ company: 'From your API', baseUrl: '', models: extra });
  }
  return groups;
}
