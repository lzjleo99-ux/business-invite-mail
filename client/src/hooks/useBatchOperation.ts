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

export interface UseBatchOperationResult {
  isRunning: boolean;
  progress: number;
  total: number;
  processed: number;
  failed: number;
  currentStage: string;
  perItemStatus: Record<string, BatchItemStatus>;
  start: () => void;
  reset: () => void;
}

export function useBatchOperation<T>(
  options: UseBatchOperationOptions<T>,
): UseBatchOperationResult {
  const { items, getItemId, operation, concurrency = 2, stageLabel, onComplete } = options;

  const [isRunning, setIsRunning] = useState(false);
  const [perItemStatus, setPerItemStatus] = useState<Record<string, BatchItemStatus>>({});
  const [processed, setProcessed] = useState(0);
  const [failed, setFailed] = useState(0);

  const runningRef = useRef(false);
  const indexRef = useRef(0);
  const successCountRef = useRef(0);
  const failCountRef = useRef(0);

  const total = items.length;
  const progress = total === 0 ? 0 : Math.round(((processed + failed) / total) * 100);

  const reset = useCallback(() => {
    runningRef.current = false;
    indexRef.current = 0;
    successCountRef.current = 0;
    failCountRef.current = 0;
    setIsRunning(false);
    setPerItemStatus({});
    setProcessed(0);
    setFailed(0);
  }, []);

  const runWorker = useCallback(async () => {
    while (runningRef.current && indexRef.current < items.length) {
      const currentIndex = indexRef.current;
      indexRef.current += 1;

      const item = items[currentIndex];
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
  }, [items, getItemId, operation]);

  const start = useCallback(() => {
    if (runningRef.current || items.length === 0) return;

    // Reset counters
    indexRef.current = 0;
    successCountRef.current = 0;
    failCountRef.current = 0;
    runningRef.current = true;

    // Initialize all as pending
    const initial: Record<string, BatchItemStatus> = {};
    for (const item of items) {
      initial[getItemId(item)] = 'pending';
    }
    setPerItemStatus(initial);
    setProcessed(0);
    setFailed(0);
    setIsRunning(true);

    // Launch workers
    const workerCount = Math.min(concurrency, items.length);
    const workers: Promise<void>[] = [];
    for (let i = 0; i < workerCount; i += 1) {
      workers.push(runWorker());
    }

    void Promise.all(workers).then(() => {
      runningRef.current = false;
      setIsRunning(false);
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
