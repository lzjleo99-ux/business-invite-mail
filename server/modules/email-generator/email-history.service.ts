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
  status: 'sent' | 'failed' | 'received';
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
      status: 'received',
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
   * 口径 = 有成功发信记录 或 收到过回复 或 手动标记过；
   * **发送失败不算**（失败记录只是诊断用的，重试时必须还能发出去）。
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
    return { ...row, bodyText: r.bodyText || '' };
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