import { Injectable, Inject, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, or, sql } from 'drizzle-orm';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { smtpConfig, restaurants } from '@server/database/schema';
import { runIdempotentMigration } from '@server/common/utils/ddl-runner';
import { EmailHistoryService } from './email-history.service';

export interface InboxPollResult {
  fetched: number;
  saved: number;
  lastUid: number;
  error?: string;
}

/**
 * 收信（IMAP）后台自动抓取：
 * - 用设置里同一套账号（客户端专用密码对 SMTP/IMAP 通用），默认 imap.exmail.qq.com:993
 * - 轮询间隔 inbox_poll_seconds（默认 180s，最小 60s），只抓 uid 大于 inbox_last_uid 的新邮件
 * - mailparser 解析 RFC822，message_id 去重（已入库的跳过）
 * - 按发件地址匹配公司（email / websiteContactEmail），对不上的也留痕（company_id 为空）
 * - 任何失败只记日志，绝不影响主服务
 */
@Injectable()
export class EmailInboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailInboxService.name);
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  private columnsPromise: Promise<void> | null = null;

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly history: EmailHistoryService,
  ) {}

  onModuleInit(): void {
    void this.bootstrap();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async bootstrap(): Promise<void> {
    try {
      await this.ensureColumns();
      const s = await this.getSettings();
      if (!s?.inboxPollEnabled) return;
      const seconds = Math.max(60, s.inboxPollSeconds || 180);
      this.logger.log(`收信轮询已启动：每 ${seconds}s 抓取一次新邮件`);
      this.timer = setInterval(() => {
        void this.poll().catch((err: unknown) => {
          this.logger.warn(`收信轮询异常（不影响主服务）：${err instanceof Error ? err.message : String(err)}`);
        });
      }, seconds * 1000);
      // 启动后先跑一次，别干等一个间隔
      void this.poll().catch(() => undefined);
    } catch (err: unknown) {
      this.logger.warn(`收信轮询启动失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** smtp_config 的 IMAP 列（自建表，幂等 ALTER 补齐） */
  private async ensureColumns(): Promise<void> {
    if (!this.columnsPromise) {
      this.columnsPromise = runIdempotentMigration(
        this.db,
        'smtp_config IMAP 列迁移',
        async (run) => {
          await run('ALTER TABLE smtp_config ADD COLUMN IF NOT EXISTS imap_host varchar(255)');
          await run('ALTER TABLE smtp_config ADD COLUMN IF NOT EXISTS imap_port integer NOT NULL DEFAULT 993');
          await run('ALTER TABLE smtp_config ADD COLUMN IF NOT EXISTS imap_secure boolean NOT NULL DEFAULT true');
          await run('ALTER TABLE smtp_config ADD COLUMN IF NOT EXISTS inbox_poll_enabled boolean NOT NULL DEFAULT false');
          await run('ALTER TABLE smtp_config ADD COLUMN IF NOT EXISTS inbox_poll_seconds integer NOT NULL DEFAULT 180');
          await run('ALTER TABLE smtp_config ADD COLUMN IF NOT EXISTS inbox_last_uid integer NOT NULL DEFAULT 0');
        },
      )
        .then((via) => {
          this.logger.log(`smtp_config IMAP 列已就绪（via ${via}）`);
        })
        .catch((err) => {
          this.columnsPromise = null;
          throw err;
        });
    }
    return this.columnsPromise;
  }

  /** 设置保存后热更新轮询开关/间隔 */
  async refreshSchedule(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.bootstrap();
  }

  private async getSettings(): Promise<typeof smtpConfig.$inferSelect | null> {
    const rows = await this.db
      .select()
      .from(smtpConfig)
      .orderBy(sql`${smtpConfig.createdAt} DESC`)
      .limit(1);
    return rows[0] ?? null;
  }

  /** 手动触发一次（设置页「立即收取」按钮） */
  async poll(): Promise<InboxPollResult> {
    if (this.polling) return { fetched: 0, saved: 0, lastUid: 0, error: '正在收取中' };
    this.polling = true;
    try {
      await this.ensureColumns();
      const s = await this.getSettings();
      if (!s || !s.host || !s.fromEmail) {
        return { fetched: 0, saved: 0, lastUid: 0, error: '发信服务未配置' };
      }
      if (!s.password) {
        return { fetched: 0, saved: 0, lastUid: 0, error: '未配置邮箱授权码' };
      }

      // IMAP 主机：优先设置里的 imap_host；否则按 SMTP 域名推导（smtp.exmail.qq.com → imap.exmail.qq.com）
      const imapHost =
        s.imapHost?.trim() ||
        (s.host.trim().startsWith('smtp.')
          ? s.host.trim().replace(/^smtp\./i, 'imap.')
          : `imap.${s.host.trim()}`);
      const imapPort = s.imapPort || 993;
      const imapSecure = s.imapSecure !== false;
      const user = s.username?.trim() || s.fromEmail;

      const client = new ImapFlow({
        host: imapHost,
        port: imapPort,
        secure: imapSecure,
        auth: { user, pass: s.password },
        logger: false,
        tls: imapSecure ? { rejectUnauthorized: false } : undefined,
      });

      await client.connect();
      let fetched = 0;
      let saved = 0;
      let maxUid = s.inboxLastUid || 0;
      try {
        const lock = await client.getMailboxLock('INBOX');
        try {
          const uids: number[] = await client.search({ uid: `${(s.inboxLastUid || 0) + 1}:*` }, { uid: true });
          for (const uid of uids) {
            fetched += 1;
            if (uid > maxUid) maxUid = uid;
            try {
              const msg = await client.fetchOne(
                `${uid}`,
                { uid: true, source: true, envelope: true },
                { uid: true },
              );
              const source = msg.source?.toString('utf8') ?? '';
              if (!source) continue;
              const parsed = await simpleParser(source);
              const messageId = parsed.messageId?.trim() || null;
              const inReplyTo = parsed.inReplyTo?.trim() || null;
              const fromAddr = parsed.from?.value?.[0]?.address?.toLowerCase() ?? '';
              const toAddrs = (parsed.to?.value ?? []).map((v) => v.address?.toLowerCase() ?? '').filter(Boolean);
              if (!fromAddr) continue;

              // 按发件地址匹配公司（同项目或任意项目的邮箱列）
              const match = await this.db
                .select({ id: restaurants.id, projectId: restaurants.projectId })
                .from(restaurants)
                .where(
                  or(
                    sql`lower(${restaurants.email}) = ${fromAddr}`,
                    sql`lower(${restaurants.websiteContactEmail}) = ${fromAddr}`,
                  ),
                )
                .limit(1);

              const ok = await this.history.recordInbound({
                companyId: match[0]?.id ?? null,
                projectId: match[0]?.projectId ?? null,
                fromAddr,
                toAddr: toAddrs[0] || s.fromEmail,
                subject: parsed.subject ?? '',
                bodyText: parsed.text ?? '',
                bodyHtml: typeof parsed.html === 'string' ? parsed.html : null,
                messageId,
                inReplyTo,
                receivedAt: parsed.date ?? new Date(),
              });
              if (ok) saved += 1;
            } catch (err: unknown) {
              this.logger.warn(`解析 uid=${uid} 邮件失败：${err instanceof Error ? err.message : String(err)}`);
            }
          }
        } finally {
          lock.release();
        }
      } finally {
        await client.logout().catch(() => undefined);
      }

      // 推进 uid 水位（即使部分解析失败也不重复抓）
      if (maxUid > (s.inboxLastUid || 0)) {
        await this.db
          .update(smtpConfig)
          .set({ inboxLastUid: maxUid })
          .where(eq(smtpConfig.id, s.id));
      }
      if (saved > 0) {
        this.logger.log(`收信轮询：抓取 ${fetched} 封，新入库 ${saved} 封（uid 水位 ${maxUid}）`);
      }
      return { fetched, saved, lastUid: maxUid };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`收信轮询失败：${msg.split('\n')[0]}`);
      return { fetched: 0, saved: 0, lastUid: 0, error: msg };
    } finally {
      this.polling = false;
    }
  }
}