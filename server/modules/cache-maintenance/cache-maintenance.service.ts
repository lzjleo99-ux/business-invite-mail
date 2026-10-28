import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { getDdlRunner } from '@server/common/utils/ddl-runner';
import { MailService } from '@server/common/services/mail.service';

/**
 * 应用自身的缓存维护。
 *
 * 重要边界：**只清理本应用产生的、可再生的缓存**，绝不动平台/系统级的东西
 * （不动 HTTP 缓存头、不动平台表结构、不删用户数据）：
 * - 孤儿图片描述（素材已删，描述还留着）
 * - AI 视觉描述缓存（vision:/fallback: 前缀，超过 14 天可重新分析）
 *   —— 人工写的描述（manual: 前缀）**永久保留**
 * - 已用过/过期的密码重置码
 * - 内存里的 SMTP transporter 缓存（改了密码/账号后强制重连）
 * - 孤儿附件 / 孤儿号码检测记录（公司已删）
 *
 * 定时：每 3 天一次（启动 10 分钟后先跑一次）；也可以随时手动触发。
 */

export interface CacheCleanupStats {
  orphanImageDescriptions: number;
  staleAiDescriptions: number;
  expiredResetCodes: number;
  orphanAttachments: number;
  orphanMessengerRows: number;
  transporterCacheCleared: boolean;
  total: number;
}

export interface CacheCleanupResult {
  trigger: 'manual' | 'scheduled';
  at: string;
  durationMs: number;
  stats: CacheCleanupStats;
}

/** 定时周期：3 天 */
export const CACHE_CLEANUP_INTERVAL_MS = 72 * 60 * 60 * 1000;
/** 启动后延迟多久先跑一次（给应用留出启动时间） */
const FIRST_RUN_DELAY_MS = 10 * 60 * 1000;
/** AI 描述缓存保留天数（人工描述不受影响） */
const AI_DESCRIPTION_TTL_DAYS = 14;

@Injectable()
export class CacheMaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheMaintenanceService.name);
  private timer: NodeJS.Timeout | null = null;
  private firstTimer: NodeJS.Timeout | null = null;
  private lastResult: CacheCleanupResult | null = null;
  private nextRunAt: string | null = null;

  constructor(private readonly mailService: MailService) {}

  onModuleInit(): void {
    // 启动后先延迟跑一次，然后每 3 天一次
    this.firstTimer = setTimeout(() => {
      void this.runScheduled();
    }, FIRST_RUN_DELAY_MS);
    if (typeof this.firstTimer.unref === 'function') this.firstTimer.unref();

    this.timer = setInterval(() => {
      void this.runScheduled();
    }, CACHE_CLEANUP_INTERVAL_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref();

    this.nextRunAt = new Date(Date.now() + CACHE_CLEANUP_INTERVAL_MS).toISOString();
    this.logger.log(
      `缓存清理已启用：每 ${CACHE_CLEANUP_INTERVAL_MS / 3600000} 小时一次（仅清理本应用的可再生缓存）`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.firstTimer) clearTimeout(this.firstTimer);
    this.timer = null;
    this.firstTimer = null;
  }

  /** 定时触发 */
  async runScheduled(): Promise<void> {
    this.nextRunAt = new Date(Date.now() + CACHE_CLEANUP_INTERVAL_MS).toISOString();
    try {
      const res = await this.clean('scheduled');
      this.logger.log(
        `定时缓存清理完成：${res.stats.total} 项`
        + `（孤儿描述 ${res.stats.orphanImageDescriptions}、过期AI描述 ${res.stats.staleAiDescriptions}、`
        + `过期验证码 ${res.stats.expiredResetCodes}、孤儿附件 ${res.stats.orphanAttachments}）`,
      );
    } catch (err: unknown) {
      this.logger.warn(
        `定时缓存清理失败（不影响功能）: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** 手动触发（首页按钮） */
  async cleanManual(): Promise<CacheCleanupResult> {
    return this.clean('manual');
  }

  /** 状态：上次清理 + 下次计划 */
  getStatus(): { lastRun: CacheCleanupResult | null; nextRunAt: string | null; intervalHours: number } {
    return {
      lastRun: this.lastResult,
      nextRunAt: this.nextRunAt,
      intervalHours: CACHE_CLEANUP_INTERVAL_MS / 3600000,
    };
  }

  private async clean(trigger: 'manual' | 'scheduled'): Promise<CacheCleanupResult> {
    const startedAt = Date.now();
    const runner = await getDdlRunner(this.mailService.getDb(), '缓存清理');
    const stats: CacheCleanupStats = {
      orphanImageDescriptions: 0,
      staleAiDescriptions: 0,
      expiredResetCodes: 0,
      orphanAttachments: 0,
      orphanMessengerRows: 0,
      transporterCacheCleared: false,
      total: 0,
    };
    try {
      // 1) 孤儿图片描述：素材已删
      stats.orphanImageDescriptions = await this.deleteWithCount(
        runner.run,
        `DELETE FROM material_image_descriptions d
         WHERE NOT EXISTS (
           SELECT 1 FROM project_materials m WHERE m.id = d.material_id
         ) RETURNING 1`,
      );

      // 2) AI 视觉描述缓存（vision:/fallback:）过期 → 可重新分析
      //    人工描述（manual:）永久保留
      stats.staleAiDescriptions = await this.deleteWithCount(
        runner.run,
        `DELETE FROM material_image_descriptions
         WHERE (description LIKE 'vision:%' OR description LIKE 'fallback:%')
           AND _updated_at < NOW() - INTERVAL '${AI_DESCRIPTION_TTL_DAYS} days'
         RETURNING 1`,
      );

      // 3) 已用过 / 过期的密码重置码（本来就无效，清掉是为了不让表无限膨胀）
      stats.expiredResetCodes = await this.deleteWithCount(
        runner.run,
        `DELETE FROM password_reset_codes
         WHERE used = TRUE OR expires_at < NOW() RETURNING 1`,
      );

      // 4) 孤儿附件（公司已删）
      stats.orphanAttachments = await this.deleteWithCount(
        runner.run,
        `DELETE FROM email_attachments a
         WHERE NOT EXISTS (
           SELECT 1 FROM restaurants r WHERE r.id = a.company_id
         ) RETURNING 1`,
      );

      // 5) 孤儿号码检测记录（公司已删）
      stats.orphanMessengerRows = await this.deleteWithCount(
        runner.run,
        `DELETE FROM messenger_registration m
         WHERE NOT EXISTS (
           SELECT 1 FROM restaurants r WHERE r.id = m.company_id
         ) RETURNING 1`,
      );

      // 6) 内存 transporter 缓存（改了 SMTP 密码后需要重新建连接）
      stats.transporterCacheCleared = this.mailService.clearTransporterCache();

      stats.total = stats.orphanImageDescriptions
        + stats.staleAiDescriptions
        + stats.expiredResetCodes
        + stats.orphanAttachments
        + stats.orphanMessengerRows;

      // 记录清理日志
      await this.ensureLogTable(runner.run);
      await runner.run(
        `INSERT INTO cache_cleanup_log (trigger, stats)
         VALUES ('${trigger}', '${JSON.stringify(stats).replace(/'/g, "''")}'::jsonb)`,
      );

      const result: CacheCleanupResult = {
        trigger,
        at: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        stats,
      };
      this.lastResult = result;
      return result;
    } finally {
      await runner.dispose();
    }
  }

  /** DELETE ... RETURNING 1 → 删掉的行数 */
  private async deleteWithCount(
    run: (q: string) => Promise<unknown>,
    sql: string,
  ): Promise<number> {
    try {
      const rows = await run(sql);
      return Array.isArray(rows) ? rows.length : 0;
    } catch (err: unknown) {
      // 表不存在（老库）时跳过，不影响其他清理项
      this.logger.warn(
        `缓存清理项执行失败（跳过）: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 0;
    }
  }

  private async ensureLogTable(run: (q: string) => Promise<unknown>): Promise<void> {
    try {
      await run(`CREATE TABLE IF NOT EXISTS cache_cleanup_log (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        trigger varchar(20) NOT NULL,
        stats jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      await run(`GRANT ALL PRIVILEGES ON TABLE cache_cleanup_log TO anon_, authenticated_, service_role_`);
    } catch {
      /* 日志表失败不影响清理本身 */
    }
  }
}
