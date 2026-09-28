import { Injectable, Inject, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq } from 'drizzle-orm';
import axios from 'axios';
import { modelConfig } from '@server/database/schema';
import type {
  ModelConfig,
  UpdateModelConfigRequest,
  TestConnectionResponse,
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

  async getConfig(): Promise<ModelConfig> {
    const rows = await this.db.select().from(modelConfig).limit(1);

    if (rows.length > 0) {
      return this.toResponse(rows[0]);
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
      })
      .returning();

    return this.toResponse(inserted[0]);
  }

  async updateConfig(data: UpdateModelConfigRequest): Promise<ModelConfig> {
    const existing = await this.getConfig();

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
      return existing;
    }

    const updated = await this.db
      .update(modelConfig)
      .set(patch)
      .where(eq(modelConfig.id, existing.id))
      .returning();

    return this.toResponse(updated[0]);
  }

  async testConnection(): Promise<TestConnectionResponse> {
    const config = await this.getConfig();

    if (!config.apiKeySet) {
      return { success: false, message: 'API Key 未设置' };
    }

    const fullRow = await this.db
      .select()
      .from(modelConfig)
      .where(eq(modelConfig.id, config.id))
      .limit(1);

    if (fullRow.length === 0) {
      return { success: false, message: '配置不存在' };
    }

    const row = fullRow[0];
    const baseUrl = row.apiBaseUrl.replace(/\/$/, '');
    const url = `${baseUrl}/chat/completions`;

    try {
      const temperature = row.temperature !== null
        ? Number(row.temperature)
        : undefined;

      const body: Record<string, unknown> = {
        model: row.modelName,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 5,
      };
      if (temperature !== undefined) {
        body.temperature = temperature;
      }

      await axios.post(url, body, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${row.apiKey}`,
        },
        timeout: 15000,
      });

      return { success: true, message: '连接成功' };
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
