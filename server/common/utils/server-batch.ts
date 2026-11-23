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

/**
 * 临时失败才值得重试；永久失败（额度/key/模型错误）重试只是白烧钱。
 * 与 ai-chat 的 permanentReason 口径一致。
 */
export function isRetryableFailure(message: string): boolean {
  const m = message.toLowerCase();
  if (/quota|余额不足|额度|invalid api key|unauthorized|authentication|模型不存在|not found|payment required/.test(m)) {
    return false;
  }
  // 网络中断、JSON 解析失败、内容为空、超时 → 可重试
  return /network|econnreset|etimedout|timeout|json|parse|内容为空|empty|socket|429|500|502|503|504/i.test(m);
}

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
  /** 失败原因（id → 错误信息（截断）），用于挑选可重试项 */
  failedReasons: Record<string, string>;
  /** 该批已自动重试过几轮 */
  retryRound: number;
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
  failed_reasons: Record<string, string> | null;
  retry_round: number | null;
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
          await run('ALTER TABLE server_batches ADD COLUMN IF NOT EXISTS failed_reasons jsonb NOT NULL DEFAULT \'{}\'::jsonb');
          await run('ALTER TABLE server_batches ADD COLUMN IF NOT EXISTS retry_round integer NOT NULL DEFAULT 0');
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
    failedReasons: r.failed_reasons ?? {},
    retryRound: r.retry_round ?? 0,
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
          processed_ids, failed_ids, failed_reasons, retry_round, targets, active_ids, started_at, updated_at, finished_at
        ) VALUES (
          ${b.key}, ${b.kind}, ${b.userId}, ${b.projectId}, ${b.total}, ${b.done}, ${b.failed},
          ${JSON.stringify(b.processedIds)}::jsonb,
          ${JSON.stringify(b.failedIds)}::jsonb,
          ${JSON.stringify(b.failedReasons)}::jsonb,
          ${b.retryRound},
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
          failed_reasons = EXCLUDED.failed_reasons,
          retry_round = EXCLUDED.retry_round,
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
      // 自愈：历史数据曾因计数顺序 bug 出现 processed=58 但 done=0，
      // 用 processedIds/failedIds 重算一次，保证界面显示与实际写库一致。
      b.done = b.processedIds.length;
      b.failed = b.failedIds.length;
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
    // 区分「断点续跑（同一批）」与「用户重新点 Generate all（新批）」：
    // targets 变了就是新批次，必须重置计数，否则 done+failed 会超过新的 total
    // （实测 53+96=149 > total 133）。同一批则保留进度继续。
    const targetsChanged =
      !!targets &&
      (targets.length !== existing.targets.length ||
        targets.some((id, i) => id !== existing.targets[i]));
    if (targetsChanged) {
      logger.warn(
        `批量 ${key} 目标列表变化（${existing.targets.length}→${targets!.length}），按新批次重置进度`,
      );
      existing.done = 0;
      existing.failed = 0;
      existing.processedIds = [];
      existing.failedIds = [];
      existing.activeIds = [];
      existing.startedAt = new Date().toISOString();
    }
    existing.total = total;
    if (targets) existing.targets = targets;
    existing.updatedAt = new Date().toISOString();
    persist(existing);
    return;
  }
  const b: ServerBatchProgress = {
    key, kind, userId, projectId, total,
    done: 0, failed: 0, processedIds: [], failedIds: [], failedReasons: {}, retryRound: 0, targets: targets ?? [], activeIds: [],
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
export function tickServerBatch(key: string, ok: boolean, companyId?: string, reason?: string): void {
  const b = registry.get(key);
  if (!b) return;
  // 先算"是否新增"再写入集合——之前先 push 再检查 includes，导致 done 永远不 +1，
  // 界面出现"批量完成：全部成功 0 条"但 generated 实际涨了 58 条的状态不一致。
  let isNew = true;
  if (companyId) {
    b.activeIds = b.activeIds.filter((id) => id !== companyId);
    if (ok) {
      isNew = !b.processedIds.includes(companyId);
      if (isNew) b.processedIds.push(companyId);
    } else {
      // 失败也记录：**同一批里不再重复处理**（否则每轮重跑都从同一批失败项开始，
      // 反复调 AI 烧 token，计数还会超过 total 显示成 101%）。
      isNew = !b.failedIds.includes(companyId);
      if (isNew) b.failedIds.push(companyId);
      if (reason) b.failedReasons[companyId] = reason.slice(0, 200);
    }
  }
  // 计数不重复累加：同一 companyId 多次只计一次（否则 done+failed 会超过 total）
  if (isNew) {
    if (ok) b.done += 1;
    else b.failed += 1;
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
    .map((b) => {
      // 读取时同样自愈（覆盖已完成、不在 init 恢复列表里的记录）
      const realDone = b.processedIds.length;
      const realFailed = b.failedIds.length;
      let changed = false;
      if (b.done !== realDone || b.failed !== realFailed) {
        b.done = realDone;
        b.failed = realFailed;
        changed = true;
      }
      // 停滞自愈：超过 15 分钟没更新且未完成 → 判定为已结束（容器重启/promise 丢失）。
      // 阈值取 15 分钟：单次 AI 调用内层最多重试 5 分钟，6 组并发下更长的静默
      // 才说明真的卡死，避免误杀仍在等待模型的正常任务。
      const idleMs = Date.now() - new Date(b.updatedAt).getTime();
      if (!b.finishedAt && idleMs > 15 * 60 * 1000) {
        b.finishedAt = b.updatedAt;
        b.activeIds = [];
        changed = true;
        logger.warn(
          `批量 ${b.key} 停滞超过 15 分钟，已标记为结束（进度 ${b.done + b.failed}/${b.total}）`,
        );
      }
      if (changed) persist(b);
      return b;
    })
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


/** 被用户手动停止的批次（进程内标记，processBatch 循环每轮检查） */
const cancelled = new Set<string>();

/** 请求停止某个批次（用户点「停止」） */
export function cancelServerBatch(key: string): boolean {
  const b = registry.get(key);
  if (!b) return false;
  cancelled.add(key);
  // 立刻标记完成：前端轮询立刻显示结束，不再转圈
  if (!b.finishedAt) {
    b.finishedAt = new Date().toISOString();
    b.updatedAt = b.finishedAt;
    b.activeIds = [];
    persist(b);
  }
  return true;
}

/** 该批次是否已被要求停止 */
export function isServerBatchCancelled(key: string): boolean {
  return cancelled.has(key);
}

/** 清除停止标记（下次重新触发同一批次时） */
export function clearServerBatchCancel(key: string): void {
  cancelled.delete(key);
}

/** 按用户+项目+类型找到批次 key（停止按钮用） */
export function findServerBatchKey(
  userId: string,
  projectId: string | null,
  kind: 'analyze' | 'generate',
): string | null {
  const key = `${kind}:${userId}:${projectId ?? 'selected'}`;
  return registry.has(key) ? key : null;
}


/** 停滞判定阈值：10 分钟无进展视为结束（AI 单次最长 5 分钟，留 2 倍余量） */
const STALL_MS = 10 * 60 * 1000;

/** 扫描并标记停滞批次；返回被标记的数量 */
export function reapStalledBatches(): number {
  let n = 0;
  const now = Date.now();
  for (const b of registry.values()) {
    if (b.finishedAt) continue;
    if (now - new Date(b.updatedAt).getTime() > STALL_MS) {
      b.finishedAt = new Date().toISOString();
      b.activeIds = [];
      b.updatedAt = b.finishedAt;
      persist(b);
      n += 1;
      logger.warn(
        `停滞批次已标记结束 ${b.key}（进度 ${b.processedIds.length + b.failedIds.length}/${b.total}）`,
      );
    }
  }
  return n;
}

/** 启动定时清理（每 2 分钟一次），由 AppModule 调用一次 */
export function startBatchReaper(): void {
  const timer = setInterval(() => {
    try {
      reapStalledBatches();
    } catch (err: unknown) {
      logger.warn(`批量清理异常: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, 2 * 60 * 1000);
  timer.unref?.(); // 不阻止进程退出
}


/** 取该批中「临时失败」的 id（供自动重试） */
export function getRetryableFailedIds(key: string): string[] {
  const b = registry.get(key);
  if (!b) return [];
  return b.failedIds.filter((id) =>
    isRetryableFailure(b.failedReasons[id] ?? ''),
  );
}

/** 开始新一轮重试：清除这些 id 的失败记录，轮次 +1 */
export function prepareRetry(key: string, ids: string[]): void {
  const b = registry.get(key);
  if (!b) return;
  const idSet = new Set(ids);
  b.failedIds = b.failedIds.filter((id) => !idSet.has(id));
  for (const id of ids) delete b.failedReasons[id];
  b.retryRound += 1;
  b.finishedAt = null; // 重新进入运行状态
  b.updatedAt = new Date().toISOString();
  persist(b);
}

/** 该批重试轮次（UI 可显示"重试第 N 轮"） */
export function getRetryRound(key: string): number {
  return registry.get(key)?.retryRound ?? 0;
}
