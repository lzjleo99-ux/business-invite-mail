import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { desc, eq } from 'drizzle-orm';
import nodemailer, { type Transporter } from 'nodemailer';
import { smtpConfig } from '@server/database/schema';

/** 全局单行的 SMTP 配置（只写密码：对外只暴露 passwordSet 布尔） */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  private transporterKey = '';

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async getSettings(): Promise<typeof smtpConfig.$inferSelect | null> {
    const rows = await this.db
      .select()
      .from(smtpConfig)
      .orderBy(desc(smtpConfig.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async isConfigured(): Promise<boolean> {
    const s = await this.getSettings();
    return !!s && !!s.host && !!s.fromEmail;
  }

  async saveSettings(input: {
    host: string;
    port: number;
    secure: boolean;
    username?: string | null;
    password?: string | null;
    fromName?: string | null;
    fromEmail: string;
    imapHost?: string | null;
    imapPort?: number;
    imapSecure?: boolean;
    inboxPollEnabled?: boolean;
    inboxPollSeconds?: number;
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
      // IMAP 收信配置（同一授权码）
      imapHost: input.imapHost !== undefined ? input.imapHost : existing?.imapHost ?? null,
      imapPort: Number.isFinite(input.imapPort) ? Number(input.imapPort) : existing?.imapPort ?? 993,
      imapSecure: input.imapSecure !== undefined ? input.imapSecure !== false : existing?.imapSecure ?? true,
      inboxPollEnabled: input.inboxPollEnabled !== undefined ? input.inboxPollEnabled : existing?.inboxPollEnabled ?? false,
      inboxPollSeconds: Number.isFinite(input.inboxPollSeconds) ? Math.max(60, Number(input.inboxPollSeconds)) : existing?.inboxPollSeconds ?? 180,
    };

    if (existing) {
      await this.db.update(smtpConfig).set(values).where(eq(smtpConfig.id, existing.id));
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
      text: `这是一封来自 BD 邮件助手的测试邮件，发送时间 ${stamp}。收到即表示 SMTP 配置可用。`,
      html: `<p>这是一封来自 <strong>BD 邮件助手</strong> 的测试邮件。</p><p>发送时间：${stamp}</p><p>收到即表示 SMTP 配置可用。</p>`,
    });
  }
}