import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { asc, desc, eq, sql } from 'drizzle-orm';
import nodemailer, { type Transporter } from 'nodemailer';
import { smtpConfig, mailInboxSettings } from '@server/database/schema';
import { runIdempotentMigration } from '@server/common/utils/ddl-runner';

/** SMTP 基础列（不含 IMAP 列）——IMAP 列是后加的，读取必须容忍「列还没建」 */
type SmtpBaseRow = Pick<
  typeof smtpConfig.$inferSelect,
  'id' | 'host' | 'port' | 'secure' | 'username' | 'password' | 'fromName' | 'fromEmail'
>;

export interface ImapSettings {
  imapHost: string | null;
  imapPort: number;
  imapSecure: boolean;
  inboxPollEnabled: boolean;
  inboxPollSeconds: number;
  inboxLastUid: number;
}

const IMAP_DEFAULTS: ImapSettings = {
  imapHost: null,
  imapPort: 993,
  imapSecure: true,
  inboxPollEnabled: false,
  inboxPollSeconds: 180,
  inboxLastUid: 0,
};

/** 全局单行的 SMTP 配置（只写密码：对外只暴露 passwordSet 布尔） */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  private transporterKey = '';
  private inboxTablePromise: Promise<void> | null = null;

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  /**
   * 只 select 基础列：IMAP 列由 ensureImapColumns() 后加创建，
   * 全量 select 在列缺失时会直接 500（读设置是启动路径也会走的）。
   */
  async getSettings(): Promise<SmtpBaseRow | null> {
    const rows = await this.db
      .select({
        id: smtpConfig.id,
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpConfig.secure,
        username: smtpConfig.username,
        password: smtpConfig.password,
        fromName: smtpConfig.fromName,
        fromEmail: smtpConfig.fromEmail,
      })
      .from(smtpConfig)
      .orderBy(desc(smtpConfig.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async isConfigured(): Promise<boolean> {
    const s = await this.getSettings();
    return !!s && !!s.host && !!s.fromEmail;
  }

  /**
   * IMAP 收信配置存放在**自建表** mail_inbox_settings（单行全局）：
   * smtp_config 是平台迁移用户建的，应用用户 ALTER 会报 must be owner
   * （project_materials 加列踩过同一个坑）——所以不能给它加列。
   * 建表只在写/轮询路径做（请求期 DDL 已验证可行）；读不到就返回默认值。
   */
  async ensureInboxTable(): Promise<void> {
    if (!this.inboxTablePromise) {
      this.inboxTablePromise = runIdempotentMigration(
        this.db,
        'mail_inbox_settings 建表迁移',
        async (run) => {
          await run(`
            CREATE TABLE IF NOT EXISTS mail_inbox_settings (
              id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              imap_host            varchar(255),
              imap_port            integer NOT NULL DEFAULT 993,
              imap_secure          boolean NOT NULL DEFAULT true,
              inbox_poll_enabled   boolean NOT NULL DEFAULT false,
              inbox_poll_seconds   integer NOT NULL DEFAULT 180,
              inbox_last_uid       integer NOT NULL DEFAULT 0,
              _created_at          timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
              _updated_at          timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
          `);
          try {
            await run('GRANT ALL PRIVILEGES ON TABLE mail_inbox_settings TO anon_, authenticated_, service_role_');
          } catch (err) {
            this.logger.warn(`mail_inbox_settings 授权失败（可忽略于非自建环境）: ${String(err).split('\n')[0]}`);
          }
        },
      )
        .then((via) => {
          this.logger.log(`mail_inbox_settings 表已就绪（via ${via}）`);
        })
        .catch((err) => {
          this.inboxTablePromise = null;
          throw err;
        });
    }
    return this.inboxTablePromise;
  }

  /** IMAP 收信配置读取：表/行不存在时返回默认值（未开启），绝不抛错 */
  async getImapSettings(): Promise<ImapSettings> {
    try {
      const result = (await this.db.execute(sql`
        SELECT imap_host AS "imapHost",
               imap_port AS "imapPort",
               imap_secure AS "imapSecure",
               inbox_poll_enabled AS "inboxPollEnabled",
               inbox_poll_seconds AS "inboxPollSeconds",
               inbox_last_uid AS "inboxLastUid"
        FROM mail_inbox_settings
        ORDER BY _created_at ASC
        LIMIT 1
      `)) as unknown as Array<Record<string, unknown>>;
      const row = result[0];
      if (!row) return IMAP_DEFAULTS;
      return {
        imapHost: typeof row.imapHost === 'string' ? row.imapHost : null,
        imapPort: Number(row.imapPort) || 993,
        imapSecure: row.imapSecure !== false,
        inboxPollEnabled: !!row.inboxPollEnabled,
        inboxPollSeconds: Number(row.inboxPollSeconds) || 180,
        inboxLastUid: Number(row.inboxLastUid) || 0,
      };
    } catch {
      // 表还没建（未跑过 ensureInboxTable）→ 视为未配置
      return IMAP_DEFAULTS;
    }
  }

  /** 保存 IMAP 配置（单行 upsert；先确保表存在） */
  async saveInboxSettings(input: {
    imapHost?: string | null;
    imapPort?: number;
    imapSecure?: boolean;
    inboxPollEnabled?: boolean;
    inboxPollSeconds?: number;
  }): Promise<void> {
    await this.ensureInboxTable();
    const prev = await this.getImapSettings();
    const values = {
      imapHost: input.imapHost !== undefined ? input.imapHost : prev.imapHost,
      imapPort: Number.isFinite(input.imapPort) ? Number(input.imapPort) : prev.imapPort,
      imapSecure: input.imapSecure !== undefined ? input.imapSecure !== false : prev.imapSecure,
      inboxPollEnabled:
        input.inboxPollEnabled !== undefined ? input.inboxPollEnabled : prev.inboxPollEnabled,
      inboxPollSeconds: Number.isFinite(input.inboxPollSeconds)
        ? Math.max(60, Number(input.inboxPollSeconds))
        : prev.inboxPollSeconds,
    };
    // drizzle 构建器（与 email_histories 同款已验证路径；raw execute 的 UPDATE 在生产库上会挂）
    const existing = await this.db
      .select({ id: mailInboxSettings.id })
      .from(mailInboxSettings)
      .orderBy(asc(mailInboxSettings.createdAt))
      .limit(1);
    if (existing[0]) {
      await this.db
        .update(mailInboxSettings)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(mailInboxSettings.id, existing[0].id));
    } else {
      await this.db.insert(mailInboxSettings).values(values);
    }
  }

  /** 推进收信 uid 水位（drizzle 构建器，与 email_histories 同款已验证路径） */
  async setInboxLastUid(uid: number): Promise<void> {
    await this.ensureInboxTable();
    const existing = await this.db
      .select({ id: mailInboxSettings.id })
      .from(mailInboxSettings)
      .orderBy(asc(mailInboxSettings.createdAt))
      .limit(1);
    if (existing[0]) {
      await this.db
        .update(mailInboxSettings)
        .set({ inboxLastUid: uid, updatedAt: new Date() })
        .where(eq(mailInboxSettings.id, existing[0].id));
    } else {
      await this.db.insert(mailInboxSettings).values({ inboxLastUid: uid });
    }
  }

  async saveSettings(input: {
    host: string;
    port: number;
    secure: boolean;
    username?: string | null;
    password?: string | null;
    fromName?: string | null;
    fromEmail: string;
  }): Promise<void> {
    if (!input.host || !input.host.trim()) {
      throw new BadRequestException('SMTP 服务器不能为空');
    }
    if (!input.fromEmail || !input.fromEmail.includes('@')) {
      throw new BadRequestException('发件人邮箱格式不正确');
    }

    const existing = await this.getSettings();
    const values = {
      host: input.host.trim(),
      port: Number.isFinite(input.port) ? Number(input.port) : 465,
      secure: input.secure !== false,
      // 密码是只写字段：留空表示不修改
      username: input.username !== undefined ? input.username : existing?.username ?? null,
      password: input.password !== undefined && input.password !== null && input.password !== ''
        ? input.password
        : existing?.password ?? null,
      fromName: input.fromName !== undefined ? input.fromName : existing?.fromName ?? null,
      fromEmail: input.fromEmail.trim(),
    };

    if (existing) {
      await this.db
        .update(smtpConfig)
        .set(values)
        .where(eq(smtpConfig.id, existing.id));
    } else {
      await this.db.insert(smtpConfig).values(values);
    }
    this.transporter = null;
    this.transporterKey = '';
  }

  private async getTransporter(): Promise<Transporter> {
    const s = await this.getSettings();
    if (!s || !s.host || !s.fromEmail) {
      throw new BadRequestException('系统尚未配置发信服务，请联系管理员在设置中配置 SMTP');
    }
    const key = JSON.stringify([s.host, s.port, s.secure, s.username, s.password]);
    if (this.transporter && this.transporterKey === key) {
      return this.transporter;
    }
    this.transporter = nodemailer.createTransport({
      host: s.host,
      port: s.port,
      secure: s.secure,
      auth: s.username ? { user: s.username, pass: s.password ?? '' } : undefined,
    });
    this.transporterKey = key;
    return this.transporter;
  }

  /** 发一封纯文本+HTML 邮件；SMTP 报原文错误由调用方决定如何呈现 */
  async sendMail(opts: {
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<void> {
    const s = await this.getSettings();
    const transporter = await this.getTransporter();
    try {
      await transporter.sendMail({
        from: s!.fromName ? `"${s!.fromName}" <${s!.fromEmail}>` : s!.fromEmail,
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
        html: opts.html,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`SMTP send failed: ${msg}`);
      throw new BadRequestException(`发信失败：${msg}`);
    }
  }

  /**
   * 发送原始 RFC822 报文（BD 群发邮件用）：
   * 报文由 eml-generator 组装（multipart/related + CID 内嵌图），
   * From/To/Subject 都在报文头里。**必须显式传 envelope** ——
   * nodemailer 的 raw 模式不解析报文头，缺 envelope 会报
   * "No recipients defined"（收件人取报文 To，寄件人取 SMTP 配置的 fromEmail）。
   */
  async sendRaw(raw: string, envelope: { from: string; to: string[] }): Promise<{ messageId: string | null }> {
    const transporter = await this.getTransporter();
    try {
      const info = await transporter.sendMail({ raw, envelope } as Parameters<Transporter['sendMail']>[0]);
      const messageId = (info as { messageId?: string }).messageId ?? null;
      return { messageId };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`SMTP raw send failed: ${msg}`);
      throw new BadRequestException(`发信失败：${msg}`);
    }
  }

  /** 管理员点「测试发信」 */
  async sendTestMail(to: string): Promise<void> {
    const stamp = new Date().toLocaleString('zh-CN');
    await this.sendMail({
      to,
      subject: '发信服务测试',
      text: `这是一封来自邮件收发助手的测试邮件，发送时间 ${stamp}。收到即表示 SMTP 配置可用。`,
      html: `<p>这是一封来自 <strong>邮件收发助手</strong> 的测试邮件。</p><p>发送时间：${stamp}</p><p>收到即表示 SMTP 配置可用。</p>`,
    });
  }
}
