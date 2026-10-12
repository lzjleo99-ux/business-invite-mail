import { Injectable, Inject, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, sql } from 'drizzle-orm';
import axios from 'axios';
import { modelConfig } from '@server/database/schema';
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
      .limit(1);

    if (rows.length > 0) {
      return rows[0];
    }

    const inserted = await this.db
      .insert(modelConfig)
      .values({
        apiBaseUrl: DEFAULT_BASE_URL,
        apiKey: '',
        modelName: DEFAULT_MODEL,
        temperature: null,
        emailLanguage: DEFAULT_EMAIL_LANGUAGE,
        senderSignature: DEFAULT_SENDER_SIGNATURE,
        createdBy: sql`ROW(${userId}::text)`,
      })
      .returning();

    return inserted[0];
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

      const resp = await axios.post(url, body, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: 15000,
        validateStatus: () => true,
      });

      const data = resp.data as Record<string, unknown>;

      if (resp.status < 200 || resp.status >= 300) {
        const errMsg = (data.error as { message?: string } | undefined)?.message;
        return {
          success: false,
          message: errMsg
            ? `HTTP ${resp.status}: ${errMsg}`
            : `HTTP ${resp.status} ${resp.statusText ?? ''}`.trim(),
        };
      }

      if (data.error || (!data.choices && !data.id)) {
        return { success: false, message: '连接失败，请检查模型名称是否正确' };
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
