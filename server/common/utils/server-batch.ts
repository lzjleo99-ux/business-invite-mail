/**
 * 服务端批量任务的进度注册表（**内存即时 + 数据库持久化**）。
 *
 * 演进：
 * - 2026-11-18：批量从浏览器驱动改为服务端后台执行（断网/关页不影响）。
 * - 2026-11-20：进度此前只在进程内存，容器重启（部署）即丢失，已处理的公司
 *   虽然结果已写库、却因进度归零看起来"从头重跑"。现在每次 tick **异步写库**，
 *   并在服务启动时**自动恢复未完成的批量，从断点继续**。
 *
 * 设计要点：
 * - 内存 registry 仍是读取源（轮询零延迟）；DB 是崩溃恢复源。
 * - startServerBatch 若同 key 有未完成记录（重启后），复用它的 processedIds。
 * - 每处理一条：内存立即 +1，异步 UPSERT 落库（失败只记日志，不影响主流程）。
 * - 服务启动时 initServerBatchStore(db) 注入数据库并加载未完成批量。
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { Logger } from '@nestjs/common';
import { runIdempotentMigration } from './ddl-runner';

const logger = new Logger('ServerBatch');

export interface ServerBatchProgress {
  /** 格式：`${kind}:${userId}:${projectId ?? 'selected'}` */
  key: string;
  kind: 'analyze' | 'generate';
  userId: string;
  projectId: string | null;
  total: number;
  done: number;
  failed: number;
  /** 已成功处理完的 company id（断点续跑时跳过） */
  processedIds: string[];
  /** 本批完整目标 id 列表（断点续跑用，避免重建队列时范围漂移） */
  targets: string[];
  /** 本批已尝试但失败的公司 id（不再自动重跑，避免反复烧 token） */
  failedIds: string[];
  /** 正在处理中、尚未完成的 company id（崩溃后视为断点，需重跑） */
  activeIds: string[];
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

interface BatchRow {
  batch_key: string;
  kind: string;
  user_id: string;
  project_id: string | null;
  total: number;
  done: number;
  failed: number;
  processed_ids: string[] | null;
  failed_ids: string[] | null;
  targets: string[] | null;
  active_ids: string[] | null;
  started_at: Date | string;
  updated_at: Date | string;
  finished_at: Date | string | null;
}

const registry = new Map<string, ServerBatchProgress>();
let dbRef: PostgresJsDatabase | null = null;
let ensurePromise: Promise<void> | null = null;

function ensureTable(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = runIdempotentMigration(
      dbRef as PostgresJsDatabase,
      'server_batches 建表迁移',
      async (run) => {
        await run(`
          CREATE TABLE IF NOT EXISTS server_batches (
            batch_key     text PRIMARY KEY,
            kind          varchar(16) NOT NULL,
            user_id       text NOT NULL,
            project_id    uuid,
            total         integer NOT NULL DEFAULT 0,
            done          integer NOT NULL DEFAULT 0,
            failed        integer NOT NULL DEFAULT 0,
            processed_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
            failed_ids   jsonb NOT NULL DEFAULT '[]'::jsonb,
            targets       jsonb NOT NULL DEFAULT '[]'::jsonb,
            active_ids    jsonb NOT NULL DEFAULT '[]'::jsonb,
            started_at    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            finished_at   timestamptz(3)
          )
        `);
        try {
          await run('ALTER TABLE server_batches ADD COLUMN IF NOT EXISTS targets jsonb NOT NULL DEFAULT \'[]\'::jsonb');
          await run('ALTER TABLE server_batches ADD COLUMN IF NOT EXISTS failed_ids jsonb NOT NULL DEFAULT \'[]\'::jsonb');
        } catch { /* 忽略 */ }
        await run(
          'CREATE INDEX IF NOT EXISTS idx_server_batches_scope ON server_batches (user_id, kind, project_id)',
        );
        try {
          await run(
            'GRANT ALL PRIVILEGES ON TABLE server_batches TO anon_, authenticated_, service_role_',
          );
        } catch {
          // 非自建环境忽略
        }
      },
    )
      .then(() => undefined)
      .catch((err: unknown) => {
        ensurePromise = null;
        throw err;
      });
  }
  return ensurePromise;
}

function toProgress(r: BatchRow): ServerBatchProgress {
  return {
    key: r.batch_key,
    kind: r.kind as 'analyze' | 'generate',
    userId: r.user_id,
    projectId: r.project_id ?? null,
    total: r.total,
    done: r.done,
    failed: r.failed,
    processedIds: Array.isArray(r.processed_ids) ? r.processed_ids : [],
    failedIds: Array.isArray(r.failed_ids) ? r.failed_ids : [],
    targets: Array.isArray(r.targets) ? r.targets : [],
    activeIds: Array.isArray(r.active_ids) ? r.active_ids : [],
    startedAt: new Date(r.started_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
    finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
  };
}

/** 异步落库（不阻塞主流程；失败只记日志，内存进度仍正确） */
function persist(b: ServerBatchProgress): void {
  if (!dbRef) return;
  void (async () => {
    try {
      await ensureTable();
      await dbRef!.execute(sql`
        INSERT INTO server_batches (
          batch_key, kind, user_id, project_id, total, done, failed,
          processed_ids, failed_ids, targets, active_ids, started_at, updated_at, finished_at
        ) VALUES (
          ${b.key}, ${b.kind}, ${b.userId}, ${b.projectId}, ${b.total}, ${b.done}, ${b.failed},
          ${JSON.stringify(b.processedIds)}::jsonb,
          ${JSON.stringify(b.failedIds)}::jsonb,
          ${JSON.stringify(b.targets)}::jsonb,
          ${JSON.stringify(b.activeIds)}::jsonb,
          ${b.startedAt}, ${b.updatedAt}, ${b.finishedAt}
        )
        ON CONFLICT (batch_key) DO UPDATE SET
          total = EXCLUDED.total,
          done = EXCLUDED.done,
          failed = EXCLUDED.failed,
          processed_ids = EXCLUDED.processed_ids,
          failed_ids = EXCLUDED.failed_ids,
          targets = EXCLUDED.targets,
          active_ids = EXCLUDED.active_ids,
          updated_at = EXCLUDED.updated_at,
          finished_at = EXCLUDED.finished_at
      `);
    } catch (err: unknown) {
      logger.warn(`批量进度落库失败 ${b.key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  })();
}

/**
 * 启动时注入数据库并恢复未完成批量（内存 registry 从 DB 加载）。
 * 由 AppModule 的 onModuleInit 调用一次。
 */
export async function initServerBatchStore(db: PostgresJsDatabase): Promise<number> {
  dbRef = db;
  try {
    await ensureTable();
    const rows = (await db.execute(sql`
      SELECT * FROM server_batches WHERE finished_at IS NULL
    `)) as unknown as BatchRow[];
    for (const r of rows) {
      const b = toProgress(r);
      // 崩溃时 activeIds 里的项没处理完 → 放回队列前先清掉，让断点续跑重新处理
      b.activeIds = [];
      registry.set(b.key, b);
      logger.log(
        `恢复未完成批量 ${b.key}: ${b.done}/${b.total}（已处理 ${b.processedIds.length} 条，从断点继续）`,
      );
    }
    return rows.length;
  } catch (err: unknown) {
    logger.warn(`批量进度恢复失败（不影响新任务）: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }
}

/**
 * 创建（或复用）批量记录。
 * 若同 key 已有未完成记录（例如容器重启后恢复的），直接复用——不重置进度。
 */
export function startServerBatch(
  key: string,
  kind: 'analyze' | 'generate',
  userId: string,
  projectId: string | null,
  total: number,
  targets?: string[],
): void {
  const existing = registry.get(key);
  if (existing && !existing.finishedAt) {
    // 断点续跑：更新 total（可能因范围变化），保留 done/processedIds
    existing.total = total;
    if (targets) existing.targets = targets;
    existing.updatedAt = new Date().toISOString();
    persist(existing);
    return;
  }
  const b: ServerBatchProgress = {
    key, kind, userId, projectId, total,
    done: 0, failed: 0, processedIds: [], failedIds: [], targets: targets ?? [], activeIds: [],
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    finishedAt: null,
  };
  registry.set(key, b);
  persist(b);
}

/** 标记某条开始处理（activeIds 追加），崩溃时这些即为断点 */
export function beginServerBatchItem(key: string, companyId: string): void {
  const b = registry.get(key);
  if (!b || b.processedIds.includes(companyId) || b.activeIds.includes(companyId)) return;
  b.activeIds.push(companyId);
  b.updatedAt = new Date().toISOString();
  persist(b);
}

/** 某条处理完成：从 activeIds 移除并加入 processedIds，done/failed +1 */
export function tickServerBatch(key: string, ok: boolean, companyId?: string): void {
  const b = registry.get(key);
  if (!b) return;
  if (companyId) {
    b.activeIds = b.activeIds.filter((id) => id !== companyId);
    if (ok) {
      if (!b.processedIds.includes(companyId)) b.processedIds.push(companyId);
    } else {
      // 失败也记录：**同一批里不再重复处理**（否则每轮重跑都从同一批失败项开始，
      // 反复调 AI 烧 token，计数还会超过 total 显示成 101%）。
      if (!b.failedIds.includes(companyId)) b.failedIds.push(companyId);
    }
  }
  // 计数不重复累加：同一 companyId 失败多次也只计一次（否则 done+failed 会超过 total）
  if (ok) {
    if (!companyId || !b.processedIds.includes(companyId)) b.done += 1;
  } else if (!companyId || !b.failedIds.includes(companyId)) {
    b.failed += 1;
  }
  b.updatedAt = new Date().toISOString();
  persist(b);
}

/** 整批完成 */
export function finishServerBatch(key: string): void {
  const b = registry.get(key);
  if (b && !b.finishedAt) {
    b.finishedAt = new Date().toISOString();
    b.activeIds = [];
    b.updatedAt = b.finishedAt;
    persist(b);
  }
}

/** 该用户某项目的批量记录（进行中优先；已完成的保留 24 小时内可查） */
export function getServerBatches(
  userId: string,
  projectId: string | null,
  kind: 'analyze' | 'generate',
): ServerBatchProgress[] {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return [...registry.values()]
    .filter(
      (b) =>
        b.userId === userId &&
        b.kind === kind &&
        (b.projectId ?? null) === (projectId ?? null) &&
        new Date(b.startedAt).getTime() > cutoff,
    )
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** 取内存中未完成的批量（供启动后自动续跑用；initServerBatchStore 后有效） */
export function listUnfinishedBatches(): ServerBatchProgress[] {
  return [...registry.values()].filter((b) => !b.finishedAt);
}

/** 取某 key 的已处理 id 集合（断点续跑跳过用） */
export function getProcessedIds(key: string): Set<string> {
  return new Set(registry.get(key)?.processedIds ?? []);
}


/** 正在续跑的 key（进程内去重，防止多次轮询重复启动同一批量） */
const resuming = new Set<string>();

/** 尝试认领一个续跑任务；返回 false 表示已在跑/已完成 */
export function claimResume(key: string): boolean {
  const b = registry.get(key);
  if (!b || b.finishedAt || resuming.has(key)) return false;
  resuming.add(key);
  return true;
}

/** 续跑结束（成功/失败都要释放） */
export function releaseResume(key: string): void {
  resuming.delete(key);
}


/** 取某 key 的失败 id 集合（续跑时跳过，避免重复烧 token） */
export function getFailedIds(key: string): Set<string> {
  return new Set(registry.get(key)?.failedIds ?? []);
}

/** 取某 key 已尝试过的全部 id（成功+失败）——重跑时默认跳过 */
export function getAttemptedIds(key: string): Set<string> {
  const b = registry.get(key);
  if (!b) return new Set();
  return new Set([...b.processedIds, ...b.failedIds]);
}
