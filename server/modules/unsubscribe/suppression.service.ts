/**
 * 退订名单（suppression list）——CAN-SPAM / GDPR 合规核心。
 *
 * 法律要求：
 * - CAN-SPAM：收到退订请求后 30 天内必须生效（我们即时生效）
 * - GDPR：数据主体有权要求不再被联系（退订即停止一切营销发送）
 *
 * 表由运行时幂等迁移创建（与其他自建表一致，无需手动 migration）。
 */
import { sql, eq } from 'drizzle-orm';
import { pgTable, uuid, varchar, timestamp, text } from 'drizzle-orm/pg-core';
import {
  runIdempotentMigration,
} from '@server/common/utils/ddl-runner';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { Inject, Injectable, Logger } from '@nestjs/common';

/** 邮箱统一小写存储；一个邮箱一条记录 */
export const emailSuppressions = pgTable('email_suppressions', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 320 }).notNull().unique(),
  /** 'user' 用户主动退订 | 'bounce' 硬退信 | 'manual' 管理员加入 */
  reason: varchar('reason', { length: 32 }).notNull().default('user'),
  /** 退订来源 IP（审计用，可空） */
  sourceIp: varchar('source_ip', { length: 64 }),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
});

interface SuppressionRow {
  email: string;
  reason: string;
}

@Injectable()
export class SuppressionService {
  private readonly logger = new Logger('Suppression');
  private ensurePromise: Promise<void> | null = null;

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  ensureTable(): Promise<void> {
    if (!this.ensurePromise) {
      this.ensurePromise = runIdempotentMigration(
        this.db,
        'email_suppressions 建表迁移',
        async (run) => {
          await run(`
            CREATE TABLE IF NOT EXISTS email_suppressions (
              id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              email       varchar(320) NOT NULL UNIQUE,
              reason      varchar(32) NOT NULL DEFAULT 'user',
              source_ip   varchar(64),
              note        text,
              created_at  timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
          `);
          await run(
            'CREATE INDEX IF NOT EXISTS idx_email_suppressions_reason ON email_suppressions (reason)',
          );
          try {
            await run(
              'GRANT ALL PRIVILEGES ON TABLE email_suppressions TO anon_, authenticated_, service_role_',
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

  /** 加入抑制名单（幂等：重复退订不报错，保留首次原因） */
  async suppress(
    emailRaw: string,
    reason: 'user' | 'bounce' | 'manual' = 'user',
    sourceIp?: string,
    note?: string,
  ): Promise<void> {
    const email = emailRaw.trim().toLowerCase();
    if (!email || !email.includes('@')) return;
    await this.ensureTable();
    await this.db.execute(sql`
      INSERT INTO email_suppressions (email, reason, source_ip, note)
      VALUES (${email}, ${reason}, ${sourceIp ?? null}, ${note ?? null})
      ON CONFLICT (email) DO NOTHING
    `);
    this.logger.warn(`邮箱已加入抑制名单: ${email} (${reason})`);
  }

  /** 是否已被抑制（发信前检查用） */
  async isSuppressed(emailRaw: string): Promise<boolean> {
    const email = emailRaw.trim().toLowerCase();
    if (!email) return false;
    await this.ensureTable();
    const rows = (await this.db.execute(sql`
      SELECT email, reason FROM email_suppressions WHERE email = ${email} LIMIT 1
    `)) as unknown as SuppressionRow[];
    return rows.length > 0;
  }

  /** 批量查已抑制邮箱（发信前一次性过滤，避免逐条查库） */
  async filterSuppressed(emails: string[]): Promise<Set<string>> {
    const normalized = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
    if (normalized.length === 0) return new Set();
    await this.ensureTable();
    // 用 = ANY 一次查完（参数化，无注入风险）
    const rows = (await this.db.execute(sql`
      SELECT email FROM email_suppressions
      WHERE email = ANY(${normalized}::varchar[])
    `)) as unknown as Array<{ email: string }>;
    return new Set(rows.map((r) => r.email.toLowerCase()));
  }

  /** 列出全部（管理 UI） */
  async list(): Promise<Array<{ email: string; reason: string; note: string | null; createdAt: string }>> {
    await this.ensureTable();
    const rows = (await this.db.execute(sql`
      SELECT email, reason, note, created_at FROM email_suppressions
      ORDER BY created_at DESC LIMIT 500
    `)) as unknown as Array<{ email: string; reason: string; note: string | null; created_at: Date }>;
    return rows.map((r) => ({
      email: r.email,
      reason: r.reason,
      note: r.note,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  }

  /** 管理员移除抑制（用户重新订阅时用） */
  async remove(emailRaw: string): Promise<boolean> {
    await this.ensureTable();
    const email = emailRaw.trim().toLowerCase();
    const result = await this.db
      .delete(emailSuppressions)
      .where(eq(emailSuppressions.email, email))
      .returning({ email: emailSuppressions.email });
    return result.length > 0;
  }
}
