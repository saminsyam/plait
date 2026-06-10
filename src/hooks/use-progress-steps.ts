/**
 * Collects pipeline ProgressEvents into an ordered step list for the
 * CookingLoader. Events with a new id append a step; repeat ids update it in
 * place. Timestamps are recorded here so the loader can show real per-step
 * durations.
 */
import { useCallback, useState } from 'react';

import type { ProgressEvent } from '@/lib/progress';

export type ProgressStep = ProgressEvent & {
  startedAt: number;
  /** Set when the step reports status 'done'. */
  endedAt?: number;
};

export function useProgressSteps() {
  const [steps, setSteps] = useState<ProgressStep[]>([]);

  const onProgress = useCallback((e: ProgressEvent) => {
    setSteps((prev) => {
      const now = Date.now();
      const i = prev.findIndex((s) => s.id === e.id);
      if (i === -1) {
        return [...prev, { ...e, startedAt: now, endedAt: e.status === 'done' ? now : undefined }];
      }
      const next = [...prev];
      next[i] = { ...next[i], ...e, endedAt: e.status === 'done' ? (next[i].endedAt ?? now) : undefined };
      return next;
    });
  }, []);

  const resetProgress = useCallback(() => setSteps([]), []);

  return { steps, onProgress, resetProgress };
}
