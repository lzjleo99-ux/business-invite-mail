import { Injectable, Inject, Logger, BadRequestException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { asc, eq, isNull, or, sql } from 'drizzle-orm';
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
              -- 归属用户；NULL = 旧的全局配置（读取时回退）
              owner_id varchar(64),
              webhook_url text,
              enabled boolean NOT NULL DEFAULT false,
              auto_star_on_reply boolean NOT NULL DEFAULT true,
              include_snippet boolean NOT NULL DEFAULT true,
              _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
              _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
            )`,
          );
          // 老库补列：表很可能是更早的部署建的（没有 owner_id），
          // CREATE TABLE IF NOT EXISTS 对已存在的表是 no-op，所以必须显式 ALTER。
          await run(
            'ALTER TABLE wecom_notify_settings ADD COLUMN IF NOT EXISTS owner_id varchar(64)',
          );
          await run(
            'CREATE INDEX IF NOT EXISTS idx_wecom_notify_owner ON wecom_notify_settings (owner_id)',
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

  async getConfig(userId?: string): Promise<WeComNotifyConfig> {
    try {
      await this.ensureTable();
      // 每用户独立：自己的行优先，没有再回退旧的全局行（owner_id IS NULL）
      const rows = userId
        ? await this.db
            .select()
            .from(wecomNotifySettings)
            .where(
              or(eq(wecomNotifySettings.ownerId, userId), isNull(wecomNotifySettings.ownerId)),
            )
            .orderBy(isNull(wecomNotifySettings.ownerId), asc(wecomNotifySettings.createdAt))
            .limit(1)
        : await this.db
            .select()
            .from(wecomNotifySettings)
            .where(isNull(wecomNotifySettings.ownerId))
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
  }, userId?: string): Promise<void> {
    await this.ensureTable();
    const prev = await this.getConfig(userId);
    const url =
      input.webhookUrl !== undefined && input.webhookUrl !== null
        ? input.webhookUrl.trim()
        : prev.webhookUrl;
    if (url && !WeComNotifyService.isWebhookUrl(url)) {
      // 必须抛 BadRequestException 而不是 Error：后者会被平台包成 500，
      // 前端只显示 "Request failed with status code 500"，用户完全不知道哪里错了。
      throw new BadRequestException(
        '这不是群机器人的 Webhook 地址。正确格式是 https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=... ' +
          '在企业微信群里「添加群机器人」后，复制弹窗里的「Webhook 地址」那一整条（不是浏览器的地址栏）。',
      );
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
    // 只在"自己的行"里找，命中旧的全局行时就地认领，避免两个用户改同一行
    const rows = userId
      ? await this.db
          .select({ id: wecomNotifySettings.id })
          .from(wecomNotifySettings)
          .where(eq(wecomNotifySettings.ownerId, userId))
          .limit(1)
      : await this.db
          .select({ id: wecomNotifySettings.id })
          .from(wecomNotifySettings)
          .where(isNull(wecomNotifySettings.ownerId))
          .limit(1);
    if (rows[0]) {
      await this.db
        .update(wecomNotifySettings)
        .set({ ...values, ownerId: userId ?? null })
        .where(eq(wecomNotifySettings.id, rows[0].id));
    } else if (userId) {
      await this.db.insert(wecomNotifySettings).values({ ...values, ownerId: userId });
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

  /** 群机器人 Webhook 必须是 qyapi 的 send?key= 形式 */
  static isWebhookUrl(url: string): boolean {
    return /^https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=[A-Za-z0-9-]+/.test(
      url.trim(),
    );
  }

  /**
   * 连通性自检：设置页「测试推送」用。
   * 允许传入未保存的地址（webhookUrl 参数）—— 否则用户必须先保存才能测，
   * 而保存失败时就没法验证自己填的地址对不对。
   */
  async test(webhookUrl?: string): Promise<{ ok: boolean; message: string }> {
    try {
      const cfg = await this.getConfig();
      const target = (webhookUrl ?? '').trim() || cfg.webhookUrl;
      if (!target) return { ok: false, message: '尚未配置 webhook 地址' };
      if (!WeComNotifyService.isWebhookUrl(target)) {
        return {
          ok: false,
          message:
            '这不是群机器人的 Webhook 地址。正确格式是 https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...',
        };
      }
      const res = await axios.post(
        target,
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
