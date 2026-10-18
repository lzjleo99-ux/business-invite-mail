import { Injectable, Inject, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { asc, eq, sql } from 'drizzle-orm';
import axios from 'axios';
import { wecomNotifySettings } from '@server/database/schema';
import { runIdempotentMigration } from '@server/common/utils/ddl-runner';

export interface WeComNotifyConfig {
  enabled: boolean;
  autoStarOnReply: boolean;
  includeSnippet: boolean;
  webhookUrl: string | null;
  webhookSet: boolean;
}

const DEFAULTS: WeComNotifyConfig = {
  enabled: false,
  autoStarOnReply: true,
  includeSnippet: true,
  webhookUrl: null,
  webhookSet: false,
};

export interface ReplyNoticeInput {
  companyName: string | null;
  fromAddr: string;
  subject: string;
  snippet: string;
}

/**
 * 企业微信群机器人通知。
 * 客户回复被 IMAP 抓到时调用 notifyReply()：往配置的 webhook 推一条 markdown。
 * - 表是自建的（平台表不能 ALTER），DDL 只在写/推送路径跑，启动期零 DDL
 * - webhook 是敏感信息：只写不读，接口只回 webhookSet
 * - 任何失败只记日志，绝不影响收信入库
 */
@Injectable()
export class WeComNotifyService {
  private readonly logger = new Logger(WeComNotifyService.name);
  private ensurePromise: Promise<void> | null = null;

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  private async ensureTable(): Promise<void> {
    if (!this.ensurePromise) {
      this.ensurePromise = runIdempotentMigration(
        this.db,
        'wecom_notify_settings',
        async (run) => {
          await run(
            `CREATE TABLE IF NOT EXISTS wecom_notify_settings (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              webhook_url text,
              enabled boolean NOT NULL DEFAULT false,
              auto_star_on_reply boolean NOT NULL DEFAULT true,
              include_snippet boolean NOT NULL DEFAULT true,
              _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
              _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
            )`,
          );
          await run(
            `GRANT ALL PRIVILEGES ON TABLE wecom_notify_settings TO anon_, authenticated_, service_role_`,
          );
        },
      )
        .then(() => undefined)
        .catch((err: unknown) => {
          this.ensurePromise = null;
          throw err;
        });
    }
    return this.ensurePromise;
  }

  async getConfig(): Promise<WeComNotifyConfig> {
    try {
      await this.ensureTable();
      const rows = await this.db
        .select()
        .from(wecomNotifySettings)
        .orderBy(asc(wecomNotifySettings.createdAt))
        .limit(1);
      const r = rows[0];
      if (!r) return { ...DEFAULTS };
      return {
        enabled: r.enabled,
        autoStarOnReply: r.autoStarOnReply,
        includeSnippet: r.includeSnippet,
        webhookUrl: r.webhookUrl,
        webhookSet: !!r.webhookUrl,
      };
    } catch {
      return { ...DEFAULTS };
    }
  }

  async saveConfig(input: {
    webhookUrl?: string | null;
    enabled?: boolean;
    autoStarOnReply?: boolean;
    includeSnippet?: boolean;
  }): Promise<void> {
    await this.ensureTable();
    const prev = await this.getConfig();
    const url =
      input.webhookUrl !== undefined && input.webhookUrl !== null
        ? input.webhookUrl.trim()
        : prev.webhookUrl;
    if (url && !/^https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=/.test(url)) {
      throw new Error('webhook 地址格式不正确，应以 https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key= 开头');
    }
    const values = {
      webhookUrl: url || null,
      enabled: input.enabled !== undefined ? input.enabled : prev.enabled,
      autoStarOnReply:
        input.autoStarOnReply !== undefined ? input.autoStarOnReply : prev.autoStarOnReply,
      includeSnippet:
        input.includeSnippet !== undefined ? input.includeSnippet : prev.includeSnippet,
      updatedAt: new Date(),
    };
    const rows = await this.db
      .select({ id: wecomNotifySettings.id })
      .from(wecomNotifySettings)
      .orderBy(asc(wecomNotifySettings.createdAt))
      .limit(1);
    if (rows[0]) {
      await this.db
        .update(wecomNotifySettings)
        .set(values)
        .where(eq(wecomNotifySettings.id, rows[0].id));
    } else {
      await this.db.insert(wecomNotifySettings).values(values);
    }
  }

  /**
   * 收到客户回复 → 推企微提醒（markdown）。
   * 未启用/未配 webhook 直接跳过；失败只记日志。
   */
  async notifyReply(input: ReplyNoticeInput): Promise<boolean> {
    try {
      const cfg = await this.getConfig();
      if (!cfg.enabled || !cfg.webhookUrl) return false;

      const who = input.companyName || input.fromAddr;
      const lines = [
        `## 📬 客户回复：${input.subject || '（无主题）'}`,
        `> **公司**：${who}`,
        `> **发件人**：${input.fromAddr}`,
      ];
      if (cfg.includeSnippet && input.snippet) {
        lines.push('', '---', input.snippet.slice(0, 300));
      }
      const res = await axios.post(
        cfg.webhookUrl,
        { msgtype: 'markdown', markdown: { content: lines.join('\n') } },
        { timeout: 10_000 },
      );
      if (res.data?.errcode) {
        this.logger.warn(
          `企微提醒返回错误 errcode=${res.data.errcode} ${res.data.errmsg ?? ''}`,
        );
        return false;
      }
      this.logger.log(`企微提醒已推送：${who}`);
      return true;
    } catch (err: unknown) {
      this.logger.warn(
        `企微提醒推送失败（不影响收信）：${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  /** 连通性自检：设置页「测试推送」用。空跑一次真实 webhook。 */
  async test(): Promise<{ ok: boolean; message: string }> {
    try {
      const cfg = await this.getConfig();
      if (!cfg.webhookUrl) return { ok: false, message: '尚未配置 webhook 地址' };
      const res = await axios.post(
        cfg.webhookUrl,
        {
          msgtype: 'markdown',
          markdown: { content: '✅ 邮件收发助手：企微提醒通道测试成功（收到此消息即配置正确）' },
        },
        { timeout: 10_000 },
      );
      if (res.data?.errcode) {
        return {
          ok: false,
          message: `errcode=${res.data.errcode} ${res.data.errmsg ?? ''}`,
        };
      }
      return { ok: true, message: '推送成功，请到群里查看' };
    } catch (err: unknown) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }
}
