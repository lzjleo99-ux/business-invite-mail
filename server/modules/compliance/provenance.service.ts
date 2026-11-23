/**
 * 邮箱来源证据（provenance）——GDPR Art.7(1) 举证 / CAN-SPAM 来源可追溯。
 *
 * 诚实说明：大多数 B2B 邮箱来自公开网站抓取或用户上传的名录，
 * 严格意义上不是"同意"(consent)，而是"合法利益"(legitimate interest,
 * GDPR Art.6(1)(f))。本表记录的是**来源证据链**，用于：
 * - 应对数据主体询问"你从哪拿到我邮箱的"（Art.14 告知义务）
 * - 证明获取方式合法（公开来源/用户提供），非购买黑名单
 * - 退订时关联到具体邮箱，撤回处理有据可查（Art.7(3)）
 *
 * 不修改平台托管的 restaurants 表（ALTER 会报 must be owner）——独立表。
 */
import { sql, eq, and } from 'drizzle-orm';
import { pgTable, uuid, varchar, timestamp, text, jsonb, index } from 'drizzle-orm/pg-core';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { runIdempotentMigration } from '@server/common/utils/ddl-runner';

export type EmailSource =
  | 'file_import'     // Excel/CSV 上传
  | 'api_import'      // 机器人自动导入
  | 'website_public'  // 官网公开页面抓取
  | 'manual';         // 用户手动填写

export const emailProvenance = pgTable(
  'email_provenance',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull(),
    projectId: uuid('project_id'),
    email: varchar('email', { length: 320 }).notNull(),
    /** 获取方式（见 EmailSource） */
    source: varchar('source', { length: 32 }).notNull(),
    /** 来源 URL：官网抓取=公司网址；文件/API=空或上传来源标识 */
    sourceUrl: text('source_url'),
    /** 补充证据：文件名 / API sourceHint / 抓取方式等 */
    details: jsonb('details'),
    /** 获取/录入时间（审计用，不用平台 _created_at 因为可能后补录） */
    capturedAt: timestamp('captured_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('idx_email_provenance_company').on(t.companyId)],
);

interface ProvenanceRow {
  email: string;
  source: string;
  source_url: string | null;
  details: unknown;
  captured_at: Date;
}

@Injectable()
export class ProvenanceService {
  private readonly logger = new Logger('EmailProvenance');
  private ensurePromise: Promise<void> | null = null;

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  ensureTable(): Promise<void> {
    if (!this.ensurePromise) {
      this.ensurePromise = runIdempotentMigration(
        this.db,
        'email_provenance 建表迁移',
        async (run) => {
          await run(`
            CREATE TABLE IF NOT EXISTS email_provenance (
              id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              company_id  uuid NOT NULL,
              project_id  uuid,
              email       varchar(320) NOT NULL,
              source      varchar(32) NOT NULL,
              source_url  text,
              details     jsonb,
              captured_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
              created_at  timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
          `);
          await run(
            'CREATE INDEX IF NOT EXISTS idx_email_provenance_company ON email_provenance (company_id)',
          );
          await run(
            'CREATE INDEX IF NOT EXISTS idx_email_provenance_email ON email_provenance (lower(email))',
          );
          try {
            await run(
              'GRANT ALL PRIVILEGES ON TABLE email_provenance TO anon_, authenticated_, service_role_',
            );
          } catch {
            // 非自建环境忽略
          }
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

  /**
   * 记录一条来源证据。幂等：同一 company+email+source+sourceUrl 只记一次，
   * 避免网站分析重跑产生大量重复证据。
   */
  async record(params: {
    companyId: string;
    projectId?: string | null;
    email: string;
    source: EmailSource;
    sourceUrl?: string | null;
    details?: Record<string, unknown>;
    capturedAt?: Date;
  }): Promise<void> {
    const email = params.email.trim().toLowerCase();
    if (!email || !email.includes('@')) return;
    await this.ensureTable();
    const srcUrl = params.sourceUrl?.trim() || null;
    const details = params.details ? JSON.stringify(params.details) : null;
    const captured = (params.capturedAt ?? new Date()).toISOString();
    // 用 NOT EXISTS 做幂等（避免唯一索引随 sourceUrl 变化冲突）
    await this.db.execute(sql`
      INSERT INTO email_provenance
        (company_id, project_id, email, source, source_url, details, captured_at)
      SELECT ${params.companyId}, ${params.projectId ?? null}, ${email}, ${params.source},
             ${srcUrl}, ${details}::jsonb, ${captured}::timestamptz
      WHERE NOT EXISTS (
        SELECT 1 FROM email_provenance
        WHERE company_id = ${params.companyId}
          AND lower(email) = ${email}
          AND source = ${params.source}
          AND source_url IS NOT DISTINCT FROM ${srcUrl}
      )
    `);
  }

  /** 批量记录（导入场景，一次事务式插入） */
  async recordMany(
    rows: Array<Parameters<ProvenanceService['record']>[0]>,
  ): Promise<void> {
    for (const row of rows) {
      try {
        await this.record(row);
      } catch (err: unknown) {
        // 单条失败不影响整批导入（证据缺失不是业务阻断）
        this.logger.warn(
          `记录邮箱来源证据失败 ${row.companyId}/${row.email}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /** 查某公司的来源证据 */
  async listByCompany(companyId: string): Promise<
    Array<{ email: string; source: string; sourceUrl: string | null; details: unknown; capturedAt: string }>
  > {
    await this.ensureTable();
    const rows = (await this.db.execute(sql`
      SELECT email, source, source_url, details, captured_at
      FROM email_provenance WHERE company_id = ${companyId}
      ORDER BY captured_at ASC
    `)) as unknown as ProvenanceRow[];
    return rows.map((r) => ({
      email: r.email,
      source: r.source,
      sourceUrl: r.source_url,
      details: r.details,
      capturedAt: new Date(r.captured_at).toISOString(),
    }));
  }

  /** 按邮箱反查（数据主体询问"你从哪拿到我邮箱"时用） */
  async listByEmail(emailRaw: string): Promise<ProvenanceRow[]> {
    await this.ensureTable();
    const email = emailRaw.trim().toLowerCase();
    return (await this.db.execute(sql`
      SELECT email, source, source_url, details, captured_at
      FROM email_provenance WHERE lower(email) = ${email}
      ORDER BY captured_at ASC
    `)) as unknown as ProvenanceRow[];
  }

  /** 项目级统计：各来源数量（合规看板用） */
  async statsByProject(projectId: string): Promise<Array<{ source: string; count: number }>> {
    await this.ensureTable();
    const rows = (await this.db.execute(sql`
      SELECT source, count(*)::int AS count
      FROM email_provenance WHERE project_id = ${projectId}
      GROUP BY source ORDER BY count DESC
    `)) as unknown as Array<{ source: string; count: number }>;
    return rows;
  }
}
