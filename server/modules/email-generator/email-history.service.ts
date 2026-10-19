import { Injectable, Inject, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq, or, ilike, sql } from 'drizzle-orm';
import { emailHistories, restaurants } from '@server/database/schema';
import { runIdempotentMigration } from '@server/common/utils/ddl-runner';

export interface EmailHistoryRow {
  id: string;
  companyId: string | null;
  companyName: string | null;
  projectId: string | null;
  direction: 'outbound' | 'inbound';
  status: 'sent' | 'failed' | 'received' | 'bounce';
  fromAddr: string;
  toAddr: string;
  subject: string;
  snippet: string;
  messageId: string | null;
  error: string | null;
  at: string; // 发信时间或收信时间
}

/** 单条往来详情：列表字段 + 完整正文 */
export interface EmailHistoryDetail extends EmailHistoryRow {
  bodyText: string;
  /** 仅退信有：解析出的失败地址与原因 */
  bounce?: BounceInfo | null;
}

export interface EmailHistoryQuery {
  companyId?: string;
  projectId?: string;
  direction?: 'outbound' | 'inbound';
  status?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

/**
 * 邮件往来历史：系统发信 + IMAP 收信全量留痕。
 * 建表走查询路径幂等 CREATE（platform 表不可 ALTER，自建表 owner 是自己）。
 */
/** 退信解析结果：退信正文是原始报告 + 原邮件引用，直接给人看等于没解析 */
export interface BounceInfo {
  /** 投递失败的地址 */
  failedAddress: string | null;
  /** 机器原因（保留原文，便于排查） */
  reason: string | null;
  /** 中文说明 */
  reasonZh: string | null;
}

const BOUNCE_REASON_RULES: { re: RegExp; zh: string }[] = [
  // 腾讯企业邮箱 / 国内网关常见措辞（放在最前，匹配更具体）
  { re: /收件人地址不存在|用户不存在|邮箱地址不存在|邮件地址不存在/, zh: '收件邮箱不存在（地址写错或已停用）' },
  { re: /域名不存在|域名无法解析|邮件域不存在/, zh: '收件域名不存在（对方可能已换域名）' },
  { re: /被拒收|拒收|黑名单|反垃圾/, zh: '被对方拒收（多为反垃圾策略）' },
  { re: /wasn't found at|does not exist|domain.*not found|no such domain|unknown domain/i, zh: '收件域名不存在（对方可能已换域名）' },
  { re: /user unknown|recipient address rejected|no such user|mailbox not found|does not exist/i, zh: '该邮箱账号不存在' },
  { re: /mailbox unavailable|mailbox full|quota exceeded/i, zh: '对方邮箱不可用或已满' },
  { re: /blocked|blacklist|spam|policy|rejected by recipient/i, zh: '被对方服务器/反垃圾策略拒收' },
  { re: /authentication|auth failed|5\.7\./i, zh: '认证失败或被 SPF/DKIM 拒收' },
  { re: /timed? ?out|connection (timed out|refused)|try again later/i, zh: '对方服务器超时或拒连（临时性，可稍后重试）' },
  { re: /too many|rate limit|throttl/i, zh: '触发对方频率限制' },
  { re: /message too large|size limit/i, zh: '邮件超出对方大小限制（附件过大）' },
];

@Injectable()
export class EmailHistoryService {
  private readonly logger = new Logger(EmailHistoryService.name);
  private ensurePromise: Promise<void> | null = null;

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  ensureTable(): Promise<void> {
    if (!this.ensurePromise) {
      this.ensurePromise = runIdempotentMigration(
        this.db,
        'email_histories 建表迁移',
        async (run) => {
          await run(`
            CREATE TABLE IF NOT EXISTS email_histories (
              id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              company_id     uuid REFERENCES restaurants(id) ON DELETE CASCADE,
              project_id     uuid,
              direction      varchar(10) NOT NULL,
              status         varchar(20) NOT NULL,
              from_addr      varchar(320) NOT NULL,
              to_addr        varchar(320) NOT NULL,
              subject        varchar(500) NOT NULL DEFAULT '',
              body_text      text NOT NULL DEFAULT '',
              body_html      text,
              message_id     varchar(255),
              in_reply_to    varchar(255),
              error          text,
              sent_at        timestamptz(3),
              received_at    timestamptz(3),
              _created_at    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
          `);
          try {
            await run('CREATE UNIQUE INDEX IF NOT EXISTS uq_email_histories_message ON email_histories (message_id)');
            await run('CREATE INDEX IF NOT EXISTS idx_email_histories_company ON email_histories (company_id, _created_at DESC)');
            await run('CREATE INDEX IF NOT EXISTS idx_email_histories_project ON email_histories (project_id, _created_at DESC)');
            await run('GRANT ALL PRIVILEGES ON TABLE email_histories TO anon_, authenticated_, service_role_');
          } catch (err) {
            this.logger.warn(`email_histories 索引/授权失败（可忽略于非自建环境）: ${String(err).split('\n')[0]}`);
          }
          // 补标历史退信：加 'bounce' 状态之前，所有 inbound 一律记成 received，
          // 导致退信被 UI 标成「收到回复」。这里按同一套特征回填一次（幂等：
          // 只改仍是 received 且命中特征的 inbound 行，重复执行不会二次命中）。
          await run(`
            UPDATE email_histories
            SET status = 'bounce'
            WHERE direction = 'inbound'
              AND status = 'received'
              AND (
                lower(from_addr) LIKE 'mailer-daemon%'
                OR lower(from_addr) LIKE 'postmaster%'
                OR lower(subject) LIKE '%undeliverable%'
                OR lower(subject) LIKE '%undelivered mail%'
                OR lower(subject) LIKE '%returned to sender%'
                OR lower(subject) LIKE '%returning message to sender%'
                OR lower(subject) LIKE '%mail delivery failed%'
                OR lower(subject) LIKE '%delivery status notification%'
                OR lower(subject) LIKE '%delivery failure%'
                OR lower(subject) LIKE '%failure notice%'
                OR lower(subject) LIKE '%returned mail%'
                OR lower(subject) LIKE '%could not be delivered%'
                OR lower(subject) LIKE '%warning: could not send%'
                OR lower(subject) LIKE '%退信%'
                OR lower(subject) LIKE '%投递失败%'
              )
          `);
        },
      )
        .then((via) => {
          this.logger.log(`email_histories 表已就绪（via ${via}）`);
        })
        .catch((err) => {
          this.ensurePromise = null;
          throw err;
        });
    }
    return this.ensurePromise;
  }

  /** 记录一封发信（成功或失败都记 —— 失败也要可追溯） */
  async recordOutbound(input: {
    companyId: string | null;
    projectId: string | null;
    fromAddr: string;
    toAddr: string;
    subject: string;
    bodyText: string;
    messageId?: string | null;
    status: 'sent' | 'failed';
    error?: string | null;
  }): Promise<void> {
    await this.ensureTable();
    await this.db.insert(emailHistories).values({
      companyId: input.companyId,
      projectId: input.projectId,
      direction: 'outbound',
      status: input.status,
      fromAddr: input.fromAddr,
      toAddr: input.toAddr,
      subject: input.subject.slice(0, 500),
      bodyText: input.bodyText.slice(0, 20000),
      messageId: input.messageId ?? null,
      error: input.error ?? null,
      sentAt: new Date(),
    });
  }

  /** 记录一封收信；message_id 已存在则跳过（轮询重复抓取） */
  async recordInbound(input: {
    companyId: string | null;
    projectId: string | null;
    fromAddr: string;
    toAddr: string;
    subject: string;
    bodyText: string;
    bodyHtml?: string | null;
    messageId?: string | null;
    inReplyTo?: string | null;
    receivedAt: Date;
    /** 'bounce' = 退信/投递失败通知，不是客户回复 */
    isBounce?: boolean;
  }): Promise<boolean> {
    await this.ensureTable();
    if (input.messageId) {
      const existing = await this.db
        .select({ id: emailHistories.id })
        .from(emailHistories)
        .where(eq(emailHistories.messageId, input.messageId))
        .limit(1);
      if (existing.length > 0) return false;
    }
    await this.db.insert(emailHistories).values({
      companyId: input.companyId,
      projectId: input.projectId,
      direction: 'inbound',
      status: input.isBounce ? 'bounce' : 'received',
      fromAddr: input.fromAddr.slice(0, 320),
      toAddr: input.toAddr.slice(0, 320),
      subject: input.subject.slice(0, 500),
      bodyText: input.bodyText.slice(0, 20000),
      bodyHtml: input.bodyHtml ? input.bodyHtml.slice(0, 50000) : null,
      messageId: input.messageId ?? null,
      inReplyTo: input.inReplyTo ?? null,
      receivedAt: input.receivedAt,
    });
    return true;
  }

  /** 该公司是否有成功发信记录（一键发送跳过判定用） */
  async hasOutboundSent(companyId: string): Promise<boolean> {
    await this.ensureTable();
    const rows = await this.db
      .select({ id: emailHistories.id })
      .from(emailHistories)
      .where(
        and(
          eq(emailHistories.companyId, companyId),
          eq(emailHistories.direction, 'outbound'),
          eq(emailHistories.status, 'sent'),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /**
   * 该公司是否「已经联系过」——一键发送的跳过判定。
   * 口径 = 有成功发信 / 收到回复 / 退信通知 的记录，或手动标记过；
   * **发送失败不算**（失败记录只是诊断用的，重试时必须还能发出去）。
   * 退信也算：地址已被对方服务器拒收，自动重发只会再退一次，应由人工换地址。
   */
  async hasCorrespondence(companyId: string): Promise<boolean> {
    await this.ensureTable();
    const rows = await this.db
      .select({ id: emailHistories.id })
      .from(emailHistories)
      .where(
        and(
          eq(emailHistories.companyId, companyId),
          or(
            eq(emailHistories.status, 'sent'),
            eq(emailHistories.status, 'received'),
            eq(emailHistories.status, 'bounce'),
          ),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /** 单条往来详情：列表只给 140 字摘要，详情页要完整正文（body_text 最多存了 2 万字） */
  async getDetail(id: string): Promise<EmailHistoryDetail | null> {
    await this.ensureTable();
    const rows = await this.db
      .select()
      .from(emailHistories)
      .where(eq(emailHistories.id, id))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    const companyName = r.companyId
      ? await this.companyNameOf(r.companyId)
      : null;
    const row = this.toRow(r, companyName);
    // 不少 MTA（腾讯企业邮箱、部分国际网关）退信**只有 HTML 没有纯文本**，
    // body_text 是空的，直接展示 = 空白弹窗，也没法解析。从 HTML 兜底出纯文本。
    let bodyText = r.bodyText || '';
    if (!bodyText.trim() && r.bodyHtml) {
      bodyText = EmailHistoryService.htmlToText(r.bodyHtml);
    }
    const detail: EmailHistoryDetail = { ...row, bodyText };
    // 退信额外给出结构化失败原因（读取时算，不落库）
    if (r.status === 'bounce' || r.direction === 'inbound') {
      detail.bounce = this.parseBounce(bodyText, r.subject || '');
    }
    return detail;
  }

  /** 极简 HTML → 纯文本：保留换行，去掉标签/样式/脚本，够用来给人看和解析 */
  private static htmlToText(html: string): string {
    return html
      .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\s*\/\s*(p|div|tr|li|h[1-6])\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * 解析退信正文，抽出"哪个地址失败了 / 为什么"——这是退信里唯一有用的信息。
   * 直接把 RFC822 原文（含 Office365 图标链接、原邮件全文引用）倒给用户等于没解析。
   * 只在读取时算，不加字段：正文已经存了，算比存更省事也不会写脏历史数据。
   */
  parseBounce(bodyText: string, subject: string): BounceInfo {
    const text = `${subject}\n${bodyText || ''}`;

    // 失败地址：Final-Recipient / Original-Recipient 最准，其次是各家的人话句式
    let failedAddress: string | null = null;
    const finalRecip = text.match(/Final-Recipient:\s*rfc822;\s*([^\s<>]+@[^\s<>]+)/i);
    const origRecip = text.match(/Original-Recipient:\s*rfc822;\s*([^\s<>]+@[^\s<>]+)/i);
    const yourMsg = text.match(/Your message to\s+([^\s,]+@[^\s,]+)\s+couldn't be delivered/i);
    const undeliverableTo = text.match(/undeliverable to\s+([^\s<>]+@[^\s<>]+)/i);
    // 腾讯企业邮箱/国内网关措辞：收件人 xxx 不存在 / 无法投递到 xxx
    const cnBounce = text.match(
      /(?:收件人|收件地址|邮件地址|地址)\s*[:：]?\s*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/,
    );
    failedAddress = (finalRecip?.[1] || origRecip?.[1] || yourMsg?.[1] || undeliverableTo?.[1] || cnBounce?.[1] || '')
      .trim() || null;
    if (failedAddress) failedAddress = failedAddress.replace(/[.,;:<>]+$/, '').toLowerCase();

    // 失败原因：优先取诊断行（Diagnostic-Code / Status），否则套规则
    let reason: string | null = null;
    const diag = text.match(/Diagnostic-Code:\s*(smtp;\s*[^\r\n]+)/i);
    const status = text.match(/\b(5\.\d{1,3}\.\d{1,3})\b/);
    if (diag) reason = diag[1].trim();
    else if (status) reason = `SMTP ${status[1]}`;

    let reasonZh: string | null = null;
    for (const rule of BOUNCE_REASON_RULES) {
      if (rule.re.test(text)) {
        reasonZh = rule.zh;
        break;
      }
    }
    if (!reasonZh) {
      reasonZh = /5\.\d/.test(text)
        ? '对方服务器拒收（原因见下方原文）'
        : null;
    }
    if (!reason && !reasonZh) return { failedAddress, reason: null, reasonZh: null };
    return { failedAddress, reason, reasonZh };
  }

  private async companyNameOf(companyId: string): Promise<string | null> {
    const rows = await this.db
      .select({ name: restaurants.name })
      .from(restaurants)
      .where(eq(restaurants.id, companyId))
      .limit(1);
    return rows[0]?.name ?? null;
  }

  /** 按公司查往来（公司行下拉/展开面板） */
  async listByCompany(companyId: string, limit = 50): Promise<EmailHistoryRow[]> {
    await this.ensureTable();
    const rows = await this.db
      .select()
      .from(emailHistories)
      .where(eq(emailHistories.companyId, companyId))
      .orderBy(desc(emailHistories.createdAt))
      .limit(limit);
    return rows.map((r) => this.toRow(r, null));
  }

  /** 全局往来记录（往来历史页）：可按项目/方向/状态/公司名搜索 + 分页 */
  async list(query: EmailHistoryQuery): Promise<{ items: EmailHistoryRow[]; total: number }> {
    await this.ensureTable();
    const conditions = [];
    if (query.companyId) conditions.push(eq(emailHistories.companyId, query.companyId));
    if (query.projectId) conditions.push(eq(emailHistories.projectId, query.projectId));
    if (query.direction) conditions.push(eq(emailHistories.direction, query.direction));
    if (query.status) conditions.push(eq(emailHistories.status, query.status));
    if (query.search) {
      conditions.push(
        or(
          ilike(emailHistories.subject, `%${query.search}%`),
          ilike(emailHistories.fromAddr, `%${query.search}%`),
          ilike(emailHistories.toAddr, `%${query.search}%`),
          ilike(restaurants.name, `%${query.search}%`),
        ),
      );
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));

    const [rows, countRow] = await Promise.all([
      this.db
        .select({
          history: emailHistories,
          companyName: restaurants.name,
        })
        .from(emailHistories)
        .leftJoin(restaurants, eq(restaurants.id, emailHistories.companyId))
        .where(where)
        .orderBy(desc(emailHistories.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(emailHistories)
        .leftJoin(restaurants, eq(restaurants.id, emailHistories.companyId))
        .where(where),
    ]);

    return {
      items: rows.map((r) => this.toRow(r.history, r.companyName)),
      total: Number(countRow[0]?.count ?? 0),
    };
  }

  private toRow(
    r: typeof emailHistories.$inferSelect,
    companyName: string | null,
  ): EmailHistoryRow {
    const at = r.sentAt ?? r.receivedAt ?? r.createdAt;
    return {
      id: r.id,
      companyId: r.companyId,
      companyName,
      projectId: r.projectId,
      direction: r.direction as EmailHistoryRow['direction'],
      status: r.status as EmailHistoryRow['status'],
      fromAddr: r.fromAddr,
      toAddr: r.toAddr,
      subject: r.subject,
      snippet: (r.bodyText || '').replace(/\s+/g, ' ').slice(0, 140),
      messageId: r.messageId,
      error: r.error,
      at: at.toISOString(),
    };
  }
}