import { Injectable, Inject, Logger, BadRequestException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { asc, desc, eq, isNull, sql } from 'drizzle-orm';
import axios from 'axios';
import { wecomNotifySettings } from '@server/database/schema';
import { runIdempotentMigration } from '@server/common/utils/ddl-runner';

export interface WeComNotifyConfig {
  enabled: boolean;
  autoStarOnReply: boolean;
  includeSnippet: boolean;
  webhookUrl: string | null;
  webhookSet: boolean;  uiLanguage: string;

}

const DEFAULTS: WeComNotifyConfig = {
  enabled: false,
  autoStarOnReply: true,
  includeSnippet: true,
  webhookUrl: null,
  webhookSet: false,
  uiLanguage: 'zh',
};

export interface ReplyNoticeInput {
  companyName: string | null;
  /** 发件人（客户） */
  fromAddr: string;
  /** 收件人（我们这边被回复的邮箱） */
  toAddr?: string | null;
  /** 抄送 */
  ccAddr?: string | null;
  subject: string;
  /** 邮件正文全文（不再只给 snippet） */
  body: string;
  /** 兼容旧字段 */
  snippet?: string;
  /** 收到时间 */
  receivedAt?: Date | string | null;
  /** 所属项目名 */
  projectName?: string | null;
  /** 邮件历史记录 id（便于追溯） */
  historyId?: string | null;
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
            'ALTER TABLE wecom_notify_settings ADD COLUMN IF NOT EXISTS ui_language varchar(8) NOT NULL DEFAULT \'zh\'',
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

  async getConfig(userId?: string, displayName?: string): Promise<WeComNotifyConfig> {
    try {
      await this.ensureTable();
      // 多租户隔离：登录用户**只读自己的行**（不再回退全局行——之前同事
      // 能通过兜底读到部署者的企微 webhook）。没有自己的行时播种一份
      // （内容从全局行复制，webhook 一并带入自己的私有行）。
      if (userId) {
        const own = await this.db
          .select()
          .from(wecomNotifySettings)
          .where(eq(wecomNotifySettings.ownerId, userId))
          .orderBy(asc(wecomNotifySettings.createdAt))
          .limit(1);
        if (own[0]) return this.toConfig(own[0]);
        // 播种
        const glob = await this.db
          .select()
          .from(wecomNotifySettings)
          .where(isNull(wecomNotifySettings.ownerId))
          .orderBy(desc(wecomNotifySettings.createdAt))
          .limit(1);
        const g = glob[0];
        const seeded = await this.db
          .insert(wecomNotifySettings)
          .values({
            ownerId: userId,
            enabled: g?.enabled ?? false,
            autoStarOnReply: g?.autoStarOnReply ?? true,
            includeSnippet: g?.includeSnippet ?? true,
            webhookUrl: g?.webhookUrl ?? null,
          })
          .returning();
        return this.toConfig(seeded[0]);
      }
      const rows = await this.db
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
        uiLanguage: r.uiLanguage || 'zh',
      };
    } catch {
      return { ...DEFAULTS };
    }
  }

  private toConfig(r: typeof wecomNotifySettings.$inferSelect): WeComNotifyConfig {
    return {
      enabled: r.enabled,
      autoStarOnReply: r.autoStarOnReply,
      includeSnippet: r.includeSnippet,
      webhookUrl: r.webhookUrl,
      webhookSet: !!r.webhookUrl,
      uiLanguage: r.uiLanguage || 'zh',
    };
  }

  async saveConfig(input: {
    webhookUrl?: string | null;
    enabled?: boolean;
    autoStarOnReply?: boolean;
    includeSnippet?: boolean;
    /** 保存时的界面语言（en/zh）：企微通知按它渲染 */
    uiLanguage?: string;
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
      // 语言只在明确传入时更新（避免旧的保存请求把语言重置回中文）
      uiLanguage:
        input.uiLanguage === 'en' || input.uiLanguage === 'zh'
          ? input.uiLanguage
          : (prev.uiLanguage || 'zh'),
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
      const lang = cfg.uiLanguage === 'en' ? 'en' : 'zh';
      const received = input.receivedAt
        ? new Date(input.receivedAt).toLocaleString(lang === 'en' ? 'en-GB' : 'zh-CN', { hour12: false })
        : new Date().toLocaleString(lang === 'en' ? 'en-GB' : 'zh-CN', { hour12: false });
      const body = String(input.body || input.snippet || '').trim();
      // 文案两套：保存配置时的界面语言决定推送语言（英文界面保存→英文推送）
      const L = lang === 'en'
        ? {
            title: (subj: string) => `## 📬 Customer reply: ${subj || '(no subject)'}`,
            company: 'Company', from: 'From', to: 'To', cc: 'Cc',
            project: 'Project', time: 'Received', record: 'Record ID',
            bodyLabel: 'Email body', bodyEmpty: '(empty body)',
            part: (i: number, n: number) => `**Body ${i}/${n}**\n`,
          }
        : {
            title: (subj: string) => `## 📬 客户回复：${subj || '（无主题）'}`,
            company: '公司', from: '发件人', to: '收件人', cc: '抄送',
            project: '项目', time: '时间', record: '记录ID',
            bodyLabel: '邮件正文', bodyEmpty: '（邮件正文为空）',
            part: (i: number, n: number) => `**正文 ${i + 1}/${n}**\n`,
          };
      const header = [
        L.title(input.subject || ''),
        `> **${L.company}**：${who}`,
        `> **${L.from}**：${input.fromAddr}`,
        `> **${L.to}**：${input.toAddr || (lang === 'en' ? '(unknown)' : '（未知）')}`,
        input.ccAddr ? `> **${L.cc}**：${input.ccAddr}` : '',
        `> **${L.project}**：${input.projectName || (lang === 'en' ? '(none)' : '（未关联）')}`,
        `> **${L.time}**：${received}`,
        input.historyId ? `> **${L.record}**：${input.historyId.slice(0, 8)}` : '',
      ].filter(Boolean).join('\n');

      // 企微 markdown 单条上限约 4096 字节：按 UTF-8 字节切正文，分多条推送。
      // 只截正文、不丢头部信息；每段标注 (i/n)。
      const maxBodyBytes = 3800; // 给 JSON 包装与头部留余量
      const chunks = this.splitByUtf8Bytes(body || (lang === 'en' ? '(empty body)' : '（邮件正文为空）'), maxBodyBytes);
      let ok = true;
      for (let i = 0; i < chunks.length; i += 1) {
        const prefix = chunks.length > 1
          ? L.part(i, chunks.length)
          : `**${L.bodyLabel}**\n`;
        const content = `${header}\n\n---\n${prefix}${chunks[i]}`;
        const res = await axios.post(
          cfg.webhookUrl,
          { msgtype: 'markdown', markdown: { content } },
          { timeout: 10_000 },
        );
        if (res.data?.errcode) {
          this.logger.warn(
            `企微提醒返回错误 errcode=${res.data.errcode} ${res.data.errmsg ?? ''}`,
          );
          ok = false;
        }
      }
      if (ok) this.logger.log(`企微提醒已推送（${chunks.length} 段）：${who}`);
      return ok;
    } catch (err: unknown) {
      this.logger.warn(
        `企微提醒推送失败（不影响收信）：${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  /** 按 UTF-8 字节切分文本（企微按字节限额，中文占 3 字节） */
  private splitByUtf8Bytes(text: string, maxBytes: number): string[] {
    const chunks: string[] = [];
    let current = '';
    let bytes = 0;
    for (const char of text) {
      const size = Buffer.byteLength(char, 'utf8');
      if (bytes + size > maxBytes && current) {
        chunks.push(current);
        current = char;
        bytes = size;
      } else {
        current += char;
        bytes += size;
      }
    }
    if (current) chunks.push(current);
    return chunks.length > 0 ? chunks : ['（正文为空）'];
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
          markdown: { content: '✅ 邮件收发助手：企微提醒通道测试成功（收到此消息即配置正确）\n> ⚠️ 这是【测试消息】，不是客户回复。真实客户回复会显示：公司、发件人、收件人、抄送、项目、时间、完整邮件正文。\n> 📌 重要：测试成功 ≠ 已启用！请回到设置页点【保存设置】按钮，让「启用回复提醒」开关生效——否则真实回复不会推送。' },
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
