/**
 * 轻量应用配置（key-value）——测试邮箱等杂项设置。
 * 独立表，运行时幂等迁移，不动平台托管表。
 */
import { sql } from 'drizzle-orm';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { runIdempotentMigration } from '@server/common/utils/ddl-runner';

@Injectable()
export class AppSettingsService {
  private readonly logger = new Logger('AppSettings');
  private ensurePromise: Promise<void> | null = null;

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  ensureTable(): Promise<void> {
    if (!this.ensurePromise) {
      this.ensurePromise = runIdempotentMigration(
        this.db,
        'app_settings 建表迁移',
        async (run) => {
          await run(`
            CREATE TABLE IF NOT EXISTS app_settings (
              key   varchar(100) PRIMARY KEY,
              value text NOT NULL,
              updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
          `);
          try {
            await run('GRANT ALL PRIVILEGES ON TABLE app_settings TO anon_, authenticated_, service_role_');
          } catch { /* 非自建环境忽略 */ }
        },
      )
        .then(() => undefined)
        .catch((err: unknown) => { this.ensurePromise = null; throw err; });
    }
    return this.ensurePromise;
  }

  async get(key: string): Promise<string | null> {
    await this.ensureTable();
    const rows = (await this.db.execute(sql`
      SELECT value FROM app_settings WHERE key = ${key}
    `)) as unknown as Array<{ value: string }>;
    return rows[0]?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.ensureTable();
    await this.db.execute(sql`
      INSERT INTO app_settings (key, value) VALUES (${key}, ${value})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
    `);
    this.logger.log(`配置已更新: ${key}`);
  }
}
