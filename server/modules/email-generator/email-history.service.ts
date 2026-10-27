import type { UserRole } from '@shared/api.interface';
import { Injectable, Inject, Logger, BadRequestException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, isNotNull, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { emailHistories, projects, restaurants } from '@server/database/schema';
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
  /** 调用者；非 admin 只能看自己项目的数据（多租户隔离） */
  user?: { userId: string; role: UserRole };
  direction?: 'outbound' | 'inbound';
  status?: string;
  search?: string;
  /** 只看某个邮箱地址的往来（发件或收件命中即算） */
  email?: string;
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
  // MX 查询失败：邮件系统找不到收件域的邮件服务器（纯 ASCII，国内网关也这么写）
  { re: /host not found|name service error|type\s*=\s*MX|nxdomain/i, zh: '收件域名不存在或未配置邮件服务器（对方可能已停用该域名）' },
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
                    // 抄送地址（2026-10-26 加）：项目归属判定要含 cc。自建表可 ALTER。
          await run(`ALTER TABLE email_histories ADD COLUMN IF NOT EXISTS cc_addr varchar(320)`);
          // 历史瘦身：入站邮件的内联图（base64）是空间黑洞，且前端不渲染 body_html
          await run(`UPDATE email_histories
            SET body_html = left(regexp_replace(body_html, '<img[^>]*>', '', 'gi'), 8000)
            WHERE body_html IS NOT NULL AND body_html LIKE '%<img%'`);
          // 退信属主（2026-10-26 加）：退信的收发件人匹配不到项目邮箱，
          // 用"谁轮询的邮箱收到的"来归属——否则所有人的退信互相可见。
          await run(`ALTER TABLE email_histories ADD COLUMN IF NOT EXISTS poll_owner uuid`);
          await run(`
            UPDATE email_histories h
            SET poll_owner = a.owner_id::uuid
            FROM smtp_accounts a
            WHERE h.status = 'bounce'
              AND h.poll_owner IS NULL
              AND lower(h.to_addr) = lower(a.email)
              AND a.owner_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
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
    /** 抄送地址，逗号分隔（可空） */
    ccAddr?: string | null;
    /** 轮询者（邮箱属主）——退信可见性按它隔离 */
    pollOwnerId?: string | null;
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
      ccAddr: input.ccAddr ? input.ccAddr.slice(0, 320) : null,
      pollOwner: input.pollOwnerId ?? null,
      subject: input.subject.slice(0, 500),
      bodyText: input.bodyText.slice(0, 20000),
      // 历史不存图片：入站 HTML 里的 <img>（base64 内联图）是空间黑洞
      // （一封能占 5 万字符），而且前端根本不渲染 bodyHtml——剥掉图片/样式后存储。
      bodyHtml: input.bodyHtml ? EmailHistoryService.stripHeavyHtml(input.bodyHtml) : null,
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
  async getDetail(
    id: string,
    user?: { userId: string; role: UserRole },
  ): Promise<EmailHistoryDetail | null> {
    await this.ensureTable();
    const row = await this.db
      .select()
      .from(emailHistories)
      .where(eq(emailHistories.id, id))
      .limit(1);
    if (row.length === 0) return null;
    // 先查行，再按它归属的公司/项目鉴权（detail 只有一个 id，没有 projectId 可传）
    await this.assertCanRead(
      { companyId: row[0].companyId ?? undefined, projectId: row[0].projectId ?? undefined },
      user,
    );
    return this.buildDetail(row[0]);
  }

  /** 行 → 详情（含正文兜底与退信解析）；不含鉴权，调用方自行保证有权读这一行 */
  private async buildDetail(r: typeof emailHistories.$inferSelect): Promise<EmailHistoryDetail> {
    const companyName = r.companyId ? await this.companyNameOf(r.companyId) : null;
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
      detail.bounce = this.parseBounce(bodyText, r.subject || '', r.fromAddr || '');
    }
    return detail;
  }

  /** 极简 HTML → 纯文本：保留换行，去掉标签/样式/脚本，够用来给人看和解析 */
  /** 去掉图片/样式/脚本并限长（历史记录只留轻量 HTML，节省空间） */
  private static stripHeavyHtml(html: string): string {
    return html
      .replace(/<img\b[^>]*>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<link\b[^>]*>/gi, '')
      .slice(0, 8000);
  }

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
  parseBounce(bodyText: string, subject: string, fromAddr = ''): BounceInfo {
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

    // 兜底：正文里第一个"不是发件人自己"的邮箱。多语言/各家格式差异太大时，
    // 英文地址本身是纯 ASCII，即使中文部分乱码也仍然完好可用。
    if (!failedAddress) {
      const all = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g);
      if (all && all.length > 0) {
        const fromLower = (fromAddr || '').toLowerCase();
        const candidate = all.find((e) => e.toLowerCase() !== fromLower);
        if (candidate) failedAddress = candidate.toLowerCase();
      }
    }
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
  async listByCompany(
    companyId: string,
    user?: { userId: string; role: UserRole },
    limit = 50,
  ): Promise<EmailHistoryRow[]> {
    await this.assertCanRead({ companyId }, user);
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
  /**
   * 校验调用者是否有权看这批往来记录。
   * 之前 list/detail/byCompany 三个接口都**不做任何归属校验**，任意登录用户
   * 传个 projectId/companyId 就能读到别人的全部邮件往来——这是数据隔离漏洞。
   * 口径与 restaurants 一致：admin 全量，其他人只能看自己项目。
   */
  private async assertCanRead(
    query: { companyId?: string; projectId?: string },
    user?: { userId: string; role: UserRole },
  ): Promise<void> {
    // 多租户隔离：登录用户一律按自己的项目校验（管理面走独立端点）
    if (!user) return;
    if (query.projectId) {
      const owned = await this.db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, query.projectId), eq(projects.ownerId, user.userId)))
        .limit(1);
      if (owned.length === 0) throw new BadRequestException('项目不存在或无权访问');
      return;
    }
    if (query.companyId) {
      const owned = await this.db
        .select({ id: restaurants.id })
        .from(restaurants)
        .innerJoin(projects, eq(projects.id, restaurants.projectId))
        .where(and(eq(restaurants.id, query.companyId), eq(projects.ownerId, user.userId)))
        .limit(1);
      if (owned.length === 0) throw new BadRequestException('公司不存在或无权访问');
      return;
    }
    // 既没给项目也没给公司 = 想看全站历史。
    // 不拒绝——「邮件往来」页本来就是跨项目查看的，拒绝会让整个页面空掉。
    // 改成按自己的项目过滤（见 list() 里的 scopeToOwnProjects）。
  }

  /**
   * 该用户能看到的项目 id；super_admin 返回 null = 不加限制（全量）。
   */
  private async visibleProjectIds(
    user?: { userId: string; role: UserRole },
  ): Promise<string[] | null> {
    // 多租户隔离：所有角色（含 super_admin）都只看自己的项目相关往来。
    // 管理面走 /api/admin/users 等独立端点，不与业务数据混流。
    if (!user) return null;
    const rows = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.ownerId, user.userId));
    return rows.map((r) => r.id);
  }

  /**
   * 收集可见项目里所有公司的邮箱地址（小写）。
   * 归属规则：一封邮件的收/发/抄送只要包含某个项目的邮箱，就属于那个项目。
   * 广告/无关邮件（收发件人不在任何项目里）一律不显示。
   */
  private async projectCompanyEmails(
    projectIds: string[] | null,
  ): Promise<string[]> {
    const rows = await this.db
      .select({ email: restaurants.email, web: restaurants.websiteContactEmail })
      .from(restaurants)
      .where(
        projectIds
          ? and(
              isNotNull(restaurants.projectId),
              inArray(restaurants.projectId, projectIds),
            )
          : isNotNull(restaurants.projectId),
      );
    const set = new Set<string>();
    for (const r of rows) {
      for (const e of [r.email, r.web]) {
        const v = (e || '').trim().toLowerCase();
        if (v) set.add(v);
      }
    }
    return [...set];
  }

  /** 收/发/抄送命中任一项目邮箱的 SQL 条件 */
  private emailMatchCondition(emails: string[]) {
    const arr = sql`ARRAY[${sql.join(
      emails.map((e) => sql`${e}`),
      sql`, `,
    )}]::text[]`;
    return or(
      sql`lower(${emailHistories.fromAddr}) = ANY(${arr})`,
      sql`lower(${emailHistories.toAddr}) = ANY(${arr})`,
      sql`lower(COALESCE(${emailHistories.ccAddr}, '')) = ANY(${arr})`,
    );
  }

  async list(query: EmailHistoryQuery): Promise<{ items: EmailHistoryRow[]; total: number }> {
    await this.assertCanRead(query, query.user);
    await this.ensureTable();
    const conditions = [];
    if (query.companyId) conditions.push(eq(emailHistories.companyId, query.companyId));
    if (query.projectId) conditions.push(eq(emailHistories.projectId, query.projectId));

    // ===== 项目归属过滤：收/发/抄送包含可见项目的公司邮箱才算 =====
    const visible = await this.visibleProjectIds(query.user);
    if (query.projectId) {
      // 显式选了项目：项目列命中 OR 邮箱命中该项目的公司邮箱
      // （入库时没匹配上的历史邮件，靠邮箱反查也能归进项目）
      const emails = await this.projectCompanyEmails([query.projectId]);
      if (emails.length > 0) {
        conditions.push(
          or(eq(emailHistories.projectId, query.projectId), this.emailMatchCondition(emails)),
        );
      }
    } else if (visible !== null) {
      // 所有人（含 super_admin）：只看自己项目相关的 + **自己邮箱**的退信
      if (visible.length === 0) return { items: [], total: 0 };
      const emails = await this.projectCompanyEmails(visible);
      conditions.push(
        or(
          and(
            isNotNull(emailHistories.projectId),
            inArray(emailHistories.projectId, visible),
          ),
          ...(emails.length > 0 ? [this.emailMatchCondition(emails)] : []),
          // 退信只看自己邮箱收到的（poll_owner = 我）
          and(
            eq(emailHistories.status, 'bounce'),
            eq(emailHistories.pollOwner, query.user!.userId),
          ),
        ),
      );
    } else {
      // 无登录上下文（服务端内部调用）：与任意项目相关 + 退信
      const emails = await this.projectCompanyEmails(null);
      if (emails.length === 0) return { items: [], total: 0 };
      conditions.push(
        or(this.emailMatchCondition(emails), eq(emailHistories.status, 'bounce')),
      );
    }
    if (query.direction) conditions.push(eq(emailHistories.direction, query.direction));
    if (query.status) conditions.push(eq(emailHistories.status, query.status));
    // 按邮箱筛选：发件人或收件人命中该地址即算（一个邮箱既可能发也可能收）
    if (query.email && query.email.trim()) {
      const addr = query.email.trim();
      conditions.push(or(eq(emailHistories.fromAddr, addr), eq(emailHistories.toAddr, addr)));
    }
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