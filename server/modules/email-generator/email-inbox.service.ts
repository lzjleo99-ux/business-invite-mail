import { Injectable, Inject, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, or, sql } from 'drizzle-orm';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { restaurants } from '@server/database/schema';
import { MailService } from '@server/common/services/mail.service';
import { EmailHistoryService } from './email-history.service';
import { WeComNotifyService } from './wecom-notify.service';

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
 * - 任何失败只记日志，绝不影响主服务；启动路径零 DDL、零 IMAP 连接
 *   （列没建时 getImapSettings 返回默认值=未开启）
 */
@Injectable()
export class EmailInboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailInboxService.name);
  private timer: NodeJS.Timeout | null = null;
  private polling = false;

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly mail: MailService,
    private readonly history: EmailHistoryService,
    private readonly wecom: WeComNotifyService,
  ) {}

  onModuleInit(): void {
    // 必须接 .catch：bootstrap 里任何拒绝（如读设置失败）若不接，Node 20 的默认
    // unhandled-rejections=throw 会直接崩进程——容器重启循环，整站 503。
    void this.bootstrap().catch((err: unknown) => {
      this.logger.warn(
        `收信轮询启动失败（不影响主服务）：${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 启动路径：只读设置，默认关闭时直接返回（零 DDL、零连接） */
  private async bootstrap(): Promise<void> {
    const imap = await this.mail.getImapSettings();
    if (!imap.inboxPollEnabled) return;
    const seconds = Math.max(60, imap.inboxPollSeconds || 180);
    this.logger.log(`收信轮询已启动：每 ${seconds}s 抓取一次新邮件`);
    this.timer = setInterval(() => {
      void this.poll().catch((err: unknown) => {
        this.logger.warn(`收信轮询异常（不影响主服务）：${err instanceof Error ? err.message : String(err)}`);
      });
    }, seconds * 1000);
    // 启动后先跑一次，别干等一个间隔
    void this.poll().catch(() => undefined);
  }

  /** 设置保存后热更新轮询开关/间隔（任何失败都不能让设置保存接口 500） */
  async refreshSchedule(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    try {
      await this.bootstrap();
    } catch (err: unknown) {
      this.logger.warn(
        `刷新收信轮询失败（不影响主服务）：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * 判断这封收信是不是退信/投递失败通知（而不是客户回复）。
   * 依据：发件人是标准退信地址，或主题命中各家 MTA 的失败通知标题。
   * 退信必须单独标记，否则所有 inbound 都被当成"收到回复"，统计和跟进都会错。
   */
  private isBounceMail(fromAddr: string, subject: string, headers: string): boolean {
    const from = fromAddr.toLowerCase();
    const subj = (subject || '').toLowerCase();
    // 发件人是退信专用地址
    if (
      from.startsWith('mailer-daemon') ||
      from.startsWith('postmaster') ||
      from.includes('mailer-daemon@') ||
      from === 'mail delivery subsystem'
    ) {
      return true;
    }
    // 主题命中常见 DSN/退信标题
    const bounceSubjects = [
      'undeliverable',
      'undelivered mail',
      'returned to sender',
      'returning message to sender',
      'mail delivery failed',
      'delivery status notification',
      'delivery failure',
      'failure notice',
      'returned mail',
      'message could not be delivered',
      'could not be delivered',
      'warning: could not send',
      '退信',
      '投递失败',
      '无法投递',
    ];
    if (bounceSubjects.some((k) => subj.includes(k))) return true;
    // RFC 3464 自动生成的退信（Content-Type: multipart/report; report-type=delivery-status）
    if (/report-type\s*=\s*delivery-status/i.test(headers)) return true;
    return false;
  }

  /**
   * 新回复的后续动作：自动星标 + 企业微信提醒。
   * 每一步都独立 try/catch：任何一步失败都不能影响收信入库（外层已入库完成）。
   */
  private async onReplyCaptured(
    companyId: string | null,
    fromAddr: string,
    subject: string,
    body: string,
  ): Promise<void> {
    try {
      const cfg = await this.wecom.getConfig();
      if (companyId && cfg.autoStarOnReply) {
        await this.db
          .update(restaurants)
          .set({ isStarred: true, updatedAt: new Date() })
          .where(eq(restaurants.id, companyId));
        this.logger.log(`客户回复已自动加星标：${fromAddr}`);
      }
    } catch (err: unknown) {
      this.logger.warn(
        `自动加星标失败（不影响收信）：${err instanceof Error ? err.message : String(err)}`,
      );
    }
    try {
      const name =
        companyId
          ? (
              await this.db
                .select({ name: restaurants.name })
                .from(restaurants)
                .where(eq(restaurants.id, companyId))
                .limit(1)
            )[0]?.name ?? null
          : null;
      await this.wecom.notifyReply({
        companyName: name,
        fromAddr,
        subject,
        snippet: (body || '').replace(/\s+/g, ' ').trim(),
      });
    } catch (err: unknown) {
      this.logger.warn(
        `企微提醒失败（不影响收信）：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** 手动触发一次（设置页「立即收取」按钮） */
  async poll(): Promise<InboxPollResult> {
    if (this.polling) return { fetched: 0, saved: 0, lastUid: 0, error: '正在收取中' };
    this.polling = true;
    try {
      const s = await this.mail.getSettings();
      if (!s || !s.host || !s.fromEmail) {
        return { fetched: 0, saved: 0, lastUid: 0, error: '发信服务未配置' };
      }
      if (!s.password) {
        return { fetched: 0, saved: 0, lastUid: 0, error: '未配置邮箱授权码' };
      }
      // IMAP 配置表在写/轮询路径补齐（请求期 DDL 已验证可行），失败就明说
      await this.mail.ensureInboxTable();
      const imap = await this.mail.getImapSettings();

      // IMAP 主机：优先设置里的 imap_host；否则按 SMTP 域名推导（smtp.exmail.qq.com → imap.exmail.qq.com）
      const imapHost =
        imap.imapHost?.trim() ||
        (s.host.trim().startsWith('smtp.')
          ? s.host.trim().replace(/^smtp\./i, 'imap.')
          : `imap.${s.host.trim()}`);
      const imapPort = imap.imapPort || 993;
      const imapSecure = imap.imapSecure !== false;
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
      let maxUid = imap.inboxLastUid || 0;
      try {
        const lock = await client.getMailboxLock('INBOX');
        try {
          const uids: number[] = await client.search(
            { uid: `${(imap.inboxLastUid || 0) + 1}:*` },
            { uid: true },
          );
          for (const uid of uids) {
            fetched += 1;
            if (uid > maxUid) maxUid = uid;
            try {
              const msg = await client.fetchOne(`${uid}`, { uid: true, source: true }, { uid: true });
              const source = msg.source?.toString('utf8') ?? '';
              if (!source) continue;
              const parsed = await simpleParser(source);
              const messageId = parsed.messageId?.trim() || null;
              const inReplyTo = parsed.inReplyTo?.trim() || null;
              const fromAddr = parsed.from?.value?.[0]?.address?.toLowerCase() ?? '';
              const toAddrs = (parsed.to?.value ?? [])
                .map((v) => v.address?.toLowerCase() ?? '')
                .filter(Boolean);
              if (!fromAddr) continue;

              // 按发件地址匹配公司（任意项目的邮箱列）
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

              const isBounce = this.isBounceMail(
                fromAddr,
                parsed.subject ?? '',
                typeof parsed.headers === 'string' ? parsed.headers : '',
              );

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
                isBounce,
              });
              if (ok) {
                saved += 1;
                // 退信不是客户回复：不加星标、不推企微（免得把投递失败当好消息）
                if (!isBounce) {
                  await this.onReplyCaptured(
                    match[0]?.id ?? null,
                    fromAddr,
                    parsed.subject ?? '',
                    parsed.text ?? '',
                  );
                } else {
                  this.logger.log(`收到退信通知（不计为回复）：${fromAddr} | ${parsed.subject ?? ''}`);
                }
              }
            } catch (err: unknown) {
              this.logger.warn(
                `解析 uid=${uid} 邮件失败：${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }
        } finally {
          lock.release();
        }
      } finally {
        await client.logout().catch(() => undefined);
      }

      // 推进 uid 水位（即使部分解析失败也不重复抓）
      if (maxUid > (imap.inboxLastUid || 0)) {
        await this.mail.setInboxLastUid(maxUid);
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
