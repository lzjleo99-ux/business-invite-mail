import { useCallback, useRef, useState } from 'react';
import { logger } from '@lark-apaas/client-toolkit/logger';

export type BatchItemStatus = 'pending' | 'processing' | 'success' | 'failed';

export interface UseBatchOperationOptions<T> {
  items: T[];
  getItemId: (item: T) => string;
  operation: (item: T) => Promise<void>;
  concurrency?: number;
  stageLabel: string;
  onComplete?: (results: { success: number; failed: number }) => void;
}

export interface UseBatchOperationResult<T> {
  isRunning: boolean;
  progress: number;
  total: number;
  processed: number;
  failed: number;
  currentStage: string;
  perItemStatus: Record<string, BatchItemStatus>;
  /** start(overrideItems?) — 不传则跑当前列表，传则跑调用方给的完整列表（不受分页限制） */
  start: (overrideItems?: T[]) => void;
  reset: () => void;
}

export function useBatchOperation<T>(
  options: UseBatchOperationOptions<T>,
): UseBatchOperationResult<T> {
  const { items, getItemId, operation, concurrency = 2, stageLabel, onComplete } = options;

  const [isRunning, setIsRunning] = useState(false);
  const [perItemStatus, setPerItemStatus] = useState<Record<string, BatchItemStatus>>({});
  const [processed, setProcessed] = useState(0);
  const [failed, setFailed] = useState(0);
  // 本轮实际跑的目标总数（override 时与 items.length 不同），null=未在跑
  const [runTotal, setRunTotal] = useState<number | null>(null);

  const runningRef = useRef(false);
  const indexRef = useRef(0);
  const successCountRef = useRef(0);
  const failCountRef = useRef(0);
  // workers 在 start 的同一个同步调用栈里启动，读不到当轮 setState ——
  // 目标列表必须走 ref，override 时同步写入。
  const workingRef = useRef<T[]>(items);

  const total = runTotal ?? items.length;
  const progress = total === 0 ? 0 : Math.round(((processed + failed) / total) * 100);

  const reset = useCallback(() => {
    runningRef.current = false;
    indexRef.current = 0;
    successCountRef.current = 0;
    failCountRef.current = 0;
    workingRef.current = items;
    setRunTotal(null);
    setIsRunning(false);
    setPerItemStatus({});
    setProcessed(0);
    setFailed(0);
  }, [items]);

  const runWorker = useCallback(async () => {
    while (runningRef.current && indexRef.current < workingRef.current.length) {
      const currentIndex = indexRef.current;
      indexRef.current += 1;

      const item = workingRef.current[currentIndex];
      const id = getItemId(item);

      setPerItemStatus((prev) => ({ ...prev, [id]: 'processing' }));

      try {
        await operation(item);
        successCountRef.current += 1;
        setPerItemStatus((prev) => ({ ...prev, [id]: 'success' }));
        setProcessed((p) => p + 1);
      } catch (err: unknown) {
        failCountRef.current += 1;
        logger.error('批量操作单项失败', id, err);
        setPerItemStatus((prev) => ({ ...prev, [id]: 'failed' }));
        setFailed((f) => f + 1);
      }
    }
  }, [getItemId, operation]);

  const start = useCallback((overrideItems?: T[]) => {
    if (runningRef.current) return;
    const list = overrideItems ?? items;
    if (list.length === 0) return;

    workingRef.current = list;

    // Reset counters
    indexRef.current = 0;
    successCountRef.current = 0;
    failCountRef.current = 0;
    runningRef.current = true;

    // Initialize all as pending
    const initial: Record<string, BatchItemStatus> = {};
    for (const item of list) {
      initial[getItemId(item)] = 'pending';
    }
    setPerItemStatus(initial);
    setProcessed(0);
    setFailed(0);
    setRunTotal(list.length);
    setIsRunning(true);

    // Launch workers
    const workerCount = Math.min(concurrency, list.length);
    const workers: Promise<void>[] = [];
    for (let i = 0; i < workerCount; i += 1) {
      workers.push(runWorker());
    }

    void Promise.all(workers).then(() => {
      runningRef.current = false;
      setIsRunning(false);
      setRunTotal(null);
      if (onComplete) {
        onComplete({
          success: successCountRef.current,
          failed: failCountRef.current,
        });
      }
    });
  }, [items, getItemId, operation, concurrency, onComplete, runWorker]);

  return {
    isRunning,
    progress,
    total,
    processed,
    failed,
    currentStage: stageLabel,
    perItemStatus,
    start,
    reset,
  };
}

export default useBatchOperation;
