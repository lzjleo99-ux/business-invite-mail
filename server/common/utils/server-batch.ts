/**
 * 服务端批量任务的进度注册表（进程内）。
 *
 * 背景（2026-11-18）：批量分析/生成此前是**浏览器驱动**的（前端逐条调 API），
 * 断网/关页/刷新都会让批量停止。现在改为**服务端后台执行**（fire-and-forget），
 * 前端只负责触发与轮询进度——断网、关页、换页面都不影响执行。
 *
 * 进度保存在进程内存里：容器重启会丢失（前端轮询拿不到记录时提示"已中断，
 * 请重新触发"即可，数据本身不受影响——每条结果在处理时就已写库）。
 */

export interface ServerBatchProgress {
  /** 格式：`${kind}:${userId}:${projectId ?? 'selected'}` */
  key: string;
  kind: 'analyze' | 'generate';
  userId: string;
  projectId: string | null;
  total: number;
  done: number;
  failed: number;
  startedAt: string;
  finishedAt: string | null;
}

const registry = new Map<string, ServerBatchProgress>();

export function startServerBatch(
  key: string,
  kind: 'analyze' | 'generate',
  userId: string,
  projectId: string | null,
  total: number,
): void {
  registry.set(key, {
    key,
    kind,
    userId,
    projectId,
    total,
    done: 0,
    failed: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  });
}

export function tickServerBatch(key: string, ok: boolean): void {
  const b = registry.get(key);
  if (!b) return;
  if (ok) b.done += 1;
  else b.failed += 1;
}

export function finishServerBatch(key: string): void {
  const b = registry.get(key);
  if (b && !b.finishedAt) b.finishedAt = new Date().toISOString();
}

/** 该用户某个项目的批量记录（进行中的优先；已完成的保留 24 小时内可查） */
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
