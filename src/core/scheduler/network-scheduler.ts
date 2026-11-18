import { performance } from "node:perf_hooks";
import type { NetworkScheduleStep } from "../../types/index.js";

export interface NetworkSchedulerCallbacks {
  applyStep: (step: NetworkScheduleStep, elapsedMs: number) => Promise<void>;
  onError?: (error: unknown, step: NetworkScheduleStep) => void;
}

/**
 * Deterministic, monotonic-time network transition scheduler.
 * Guarantees ordered execution, clean cancellation, and zero timer leakage between scenarios.
 */
export class NetworkScheduler {
  private timers: Set<ReturnType<typeof setTimeout>> = new Set();
  private running = false;
  private cancelled = false;
  private startHrMs = 0;
  private pendingChain: Promise<void> = Promise.resolve();
  private abortController?: AbortController;

  isRunning(): boolean {
    return this.running;
  }

  start(
    steps: NetworkScheduleStep[],
    callbacks: NetworkSchedulerCallbacks,
    options?: { repeat?: boolean; signal?: AbortSignal },
  ): void {
    this.stop();

    if (steps.length === 0) return;

    const sorted = [...steps].sort((a, b) => a.atMs - b.atMs);
    this.running = true;
    this.cancelled = false;
    this.abortController = new AbortController();

    if (options?.signal) {
      if (options.signal.aborted) {
        this.stop();
        return;
      }
      options.signal.addEventListener("abort", () => this.stop(), { once: true });
    }

    const scheduleCycle = () => {
      if (this.cancelled) return;
      this.startHrMs = performance.now();

      for (const step of sorted) {
        const delay = Math.max(0, step.atMs);
        const timer = setTimeout(() => {
          this.timers.delete(timer);
          if (this.cancelled) return;
          const elapsed = Math.round((performance.now() - this.startHrMs) * 100) / 100;
          // Chain step applications sequentially to keep event ordering deterministic
          this.pendingChain = this.pendingChain.then(async () => {
            if (this.cancelled) return;
            try {
              await callbacks.applyStep(step, elapsed);
            } catch (error) {
              callbacks.onError?.(error, step);
            }
          });
        }, delay);
        this.timers.add(timer);
      }

      if (options?.repeat) {
        const cycleLength = Math.max(100, (sorted[sorted.length - 1]?.atMs ?? 0) + 100);
        const repeatTimer = setTimeout(() => {
          this.timers.delete(repeatTimer);
          if (!this.cancelled) {
            scheduleCycle();
          }
        }, cycleLength);
        this.timers.add(repeatTimer);
      } else {
        const lastAt = sorted[sorted.length - 1]?.atMs ?? 0;
        const doneTimer = setTimeout(() => {
          this.timers.delete(doneTimer);
          if (!this.cancelled && this.timers.size === 0) {
            this.running = false;
          }
        }, lastAt + 20);
        this.timers.add(doneTimer);
      }
    };

    scheduleCycle();
  }

  stop(): void {
    this.cancelled = true;
    this.running = false;
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    if (this.abortController && !this.abortController.signal.aborted) {
      this.abortController.abort();
    }
    this.abortController = undefined;
  }

  async flush(): Promise<void> {
    await this.pendingChain;
  }
}
