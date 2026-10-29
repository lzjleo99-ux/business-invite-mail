import { Injectable, Inject, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, asc, sql } from 'drizzle-orm';
import axios from 'axios';
import { postChatCompletions } from '@server/common/utils/ai-chat';
import { modelConfig, appUsers } from '@server/database/schema';
import type {
  ModelConfig,
  UpdateModelConfigRequest,
  TestConnectionResponse,
  TestConnectionRequest,
} from '@shared/api.interface';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_EMAIL_LANGUAGE = 'auto' as const;
const DEFAULT_SENDER_SIGNATURE = 'Best regards,\nBD Team';


/** 内置模型清单：中转拉不到列表时的兜底，同时提供中文描述 */
const BUILTIN_MODELS: Array<{ id: string; description: string }> = [
  { id: 'TPK/GLM-5.2', description: '综合能力最强（推荐）' },
  { id: 'TPK/DeepSeek-V4-Flash', description: '速度快、省额度' },
  { id: 'TPK/Qwen3.6-35B-A3B', description: '中文好、性价比高' },
  { id: 'TPK/Qwen3.8-27B', description: '轻量快速' },
];

@Injectable()
export class ModelConfigService {
  private readonly logger = new Logger(ModelConfigService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  /**
   * 取当前用户的 AI 配置行；不存在则用默认值建一行。
   * 每个用户一行（用 _created_by.user_id 归属），互不影响——各人填各人的 API Key、各自计费。
   */
  async getUserRow(userId: string): Promise<typeof modelConfig.$inferSelect> {
    const rows = await this.db
      .select()
      .from(modelConfig)
      .where(sql`(${modelConfig.createdBy}).user_id = ${userId}`)
      .orderBy(sql`_created_at asc`)
      .limit(1);

    if (rows.length > 0) {
      return rows[0];
    }

    // 新用户播种：从**部署所有者**（最早注册用户）的行复制一份工作配置作起点
    // （GitHub "fork from default profile" 模式）——团队成员拿到能用的 Key/签名，
    // 之后各自修改互不影响。所有者自己还没有行时才用出厂默认值。
    const seed = await this.seedFromOwner(userId);
    const inserted = await this.db
      .insert(modelConfig)
      .values({
        apiBaseUrl: seed.apiBaseUrl,
        apiKey: seed.apiKey,
        modelName: seed.modelName,
        temperature: null,
        emailLanguage: seed.emailLanguage,
        senderSignature: seed.senderSignature,
        createdBy: sql`ROW(${userId}::text)`,
      })
      .returning();

    return inserted[0];
  }

  /** 部署所有者（最早注册用户）的配置；没有则返回出厂默认值 */
  private async seedFromOwner(userId: string): Promise<{
    apiBaseUrl: string; apiKey: string; modelName: string;
    emailLanguage: string; senderSignature: string;
  }> {
    const defaults = {
      apiBaseUrl: DEFAULT_BASE_URL,
      apiKey: '',
      modelName: DEFAULT_MODEL,
      emailLanguage: DEFAULT_EMAIL_LANGUAGE,
      senderSignature: DEFAULT_SENDER_SIGNATURE,
    };
    try {
      const ownerRows = await this.db
        .select({
          apiBaseUrl: modelConfig.apiBaseUrl,
          apiKey: modelConfig.apiKey,
          modelName: modelConfig.modelName,
          emailLanguage: modelConfig.emailLanguage,
          senderSignature: modelConfig.senderSignature,
        })
        .from(modelConfig)
        .innerJoin(appUsers, sql`(${modelConfig.createdBy}).user_id = ${appUsers.id}::text`)
        .where(sql`${appUsers.createdAt} = (SELECT MIN(_created_at) FROM app_users)`)
        .limit(1);
      const o = ownerRows[0];
      if (!o) return defaults;
      return {
        apiBaseUrl: o.apiBaseUrl || defaults.apiBaseUrl,
        apiKey: o.apiKey || '',
        modelName: o.modelName || defaults.modelName,
        emailLanguage: o.emailLanguage || defaults.emailLanguage,
        senderSignature: o.senderSignature || defaults.senderSignature,
      };
    } catch (err: unknown) {
      this.logger?.warn?.(`播种读取所有者配置失败，用默认值: ${err instanceof Error ? err.message : String(err)}`);
      return defaults;
    }
  }

  async getConfig(userId: string): Promise<ModelConfig> {
    return this.toResponse(await this.getUserRow(userId));
  }

  async updateConfig(userId: string, data: UpdateModelConfigRequest): Promise<ModelConfig> {
    const existing = await this.getUserRow(userId);

    const patch: Record<string, unknown> = {};
    if (data.apiBaseUrl !== undefined) patch.apiBaseUrl = data.apiBaseUrl;
    if (data.apiKey !== undefined) patch.apiKey = data.apiKey;
    if (data.modelName !== undefined) patch.modelName = data.modelName;
    if (data.temperature !== undefined) {
      patch.temperature = data.temperature;
    }
    if (data.emailLanguage !== undefined) patch.emailLanguage = data.emailLanguage;
    if (data.senderSignature !== undefined) patch.senderSignature = data.senderSignature;

    if (Object.keys(patch).length === 0) {
      return this.toResponse(existing);
    }

    const updated = await this.db
      .update(modelConfig)
      .set(patch)
      .where(eq(modelConfig.id, existing.id))
      .returning();

    return this.toResponse(updated[0]);
  }

  async testConnection(
    userId: string,
    dto: TestConnectionRequest = {},
  ): Promise<TestConnectionResponse> {
    const row = await this.getUserRow(userId);

    const baseUrl = (dto.apiBaseUrl ?? row.apiBaseUrl).trim();
    const model = (dto.modelName ?? row.modelName).trim();
    const apiKey = (dto.apiKey?.trim() ?? '') || row.apiKey;
    const temperature = dto.temperature !== undefined
      ? dto.temperature
      : row.temperature !== null
        ? Number(row.temperature)
        : null;

    if (!baseUrl) {
      return { success: false, message: 'API Base URL 不能为空' };
    }
    if (!model) {
      return { success: false, message: '模型名称不能为空' };
    }
    if (!apiKey) {
      return { success: false, message: 'API Key 未设置' };
    }

    const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

    try {
      const body: Record<string, unknown> = {
        model,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 5,
      };
      if (temperature !== null) {
        body.temperature = temperature;
      }

      // 统一入口：新模型（gpt-5/o 系）不吃 max_tokens/temperature 时会自动适配重试
      const resp = await postChatCompletions(
        url,
        body,
        {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        { timeout: 15000, label: 'model-test' },
      );

      const data = resp.data as Record<string, unknown>;

      if (data.error || (!data.choices && !data.id)) {
        const errMsg = (data.error as { message?: string } | undefined)?.message;
        return {
          success: false,
          message: errMsg ? `HTTP ${resp.status}: ${errMsg}` : '连接失败，请检查模型名称是否正确',
        };
      }

      return { success: true, message: `连接成功（模型：${model}）` };
    } catch (err: unknown) {
      this.logger.warn(`Model API test connection failed: ${String(err)}`);
      let message = '未知错误';
      if (err instanceof Error) {
        if (axios.isAxiosError(err)) {
          const status = err.response?.status;
          const respMessage = (err.response?.data as { error?: { message?: string } })?.error?.message;
          if (status && respMessage) {
            message = `HTTP ${status}: ${respMessage}`;
          } else if (status) {
            message = `HTTP ${status} ${err.response?.statusText ?? ''}`.trim();
          } else if (err.code === 'ECONNABORTED') {
            message = '请求超时（15秒）';
          } else {
            message = err.message;
          }
        } else {
          message = err.message;
        }
      }
      return { success: false, message };
    }
  }


  /**
   * 可选模型列表：优先从中转服务实时拉取（用当前用户自己存的 Base URL + Key 调
   * {baseUrl}/models），拉取失败或没配 Key 时回退到内置列表，保证下拉永远有东西可选。
   * 描述以内置为准（中转不提供中文描述）。
   */
  async listModels(userId: string): Promise<{
    models: Array<{ id: string; description: string }>;
    live: boolean;
  }> {
    const builtin = BUILTIN_MODELS.map((m) => ({ ...m }));
    const row = await this.getUserRow(userId);

    if (!row.apiKey || !row.apiKey.trim() || !row.apiBaseUrl) {
      return { models: builtin, live: false };
    }

    try {
      const url = `${row.apiBaseUrl.replace(/\/$/, '')}/models`;
      const resp = await axios.get<{ data?: Array<{ id?: string }> }>(url, {
        headers: { Authorization: `Bearer ${row.apiKey}` },
        timeout: 10000,
      });
      const ids = (resp.data?.data ?? [])
        .map((m) => (typeof m?.id === 'string' ? m.id.trim() : ''))
        .filter((id): id is string => !!id);
      if (ids.length === 0) {
        return { models: builtin, live: false };
      }
      const known = new Map(BUILTIN_MODELS.map((m) => [m.id, m.description]));
      return {
        models: ids.map((id) => ({
          id,
          description: known.get(id) ?? '服务端可用模型',
        })),
        live: true,
      };
    } catch {
      return { models: builtin, live: false };
    }
  }

  private toResponse(row: typeof modelConfig.$inferSelect): ModelConfig {
    return {
      id: row.id,
      apiBaseUrl: row.apiBaseUrl,
      apiKeySet: row.apiKey.length > 0,
      modelName: row.modelName,
      temperature: row.temperature !== null ? Number(row.temperature) : null,
      emailLanguage: row.emailLanguage as ModelConfig['emailLanguage'],
      senderSignature: row.senderSignature,
    };
  }
}
