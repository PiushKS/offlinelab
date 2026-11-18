import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import { Redactor } from "../../security/redactor.js";
import type {
  ConsoleEntry,
  EventSeverity,
  OfflineLabEvent,
  RecordedRequest,
} from "../../types/index.js";

export type EventListener = (event: OfflineLabEvent) => void | Promise<void>;

export interface EventRecorderOptions {
  runId: string;
  scenarioId: string;
  maxEvents?: number;
  maxRequests?: number;
  redactor?: Redactor;
  listeners?: EventListener[];
}

export class EventRecorder {
  private readonly runId: string;
  private readonly scenarioId: string;
  private readonly startHrMs: number;
  private readonly maxEvents: number;
  private readonly maxRequests: number;
  private readonly redactor: Redactor;
  private readonly listeners: Set<EventListener>;

  private readonly events: OfflineLabEvent[] = [];
  private readonly requests: RecordedRequest[] = [];
  private readonly consoleEntries: ConsoleEntry[] = [];
  private droppedEvents = 0;
  private droppedRequests = 0;

  constructor(options: EventRecorderOptions) {
    this.runId = options.runId;
    this.scenarioId = options.scenarioId;
    this.startHrMs = performance.now();
    this.maxEvents = options.maxEvents ?? 2000;
    this.maxRequests = options.maxRequests ?? 1000;
    this.redactor = options.redactor ?? new Redactor();
    this.listeners = new Set(options.listeners ?? []);
  }

  getElapsedMs(): number {
    return Math.max(0, Math.round((performance.now() - this.startHrMs) * 100) / 100);
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  record(
    type: string,
    details: Record<string, unknown> = {},
    severity: EventSeverity = "info",
  ): OfflineLabEvent {
    const event: OfflineLabEvent = {
      id: `evt_${crypto.randomUUID().slice(0, 12)}`,
      timestamp: new Date().toISOString(),
      elapsedMs: this.getElapsedMs(),
      runId: this.runId,
      scenarioId: this.scenarioId,
      type,
      severity,
      details: this.redactor.redactObject(details),
    };

    if (this.events.length < this.maxEvents) {
      this.events.push(event);
    } else {
      this.droppedEvents += 1;
    }

    for (const listener of this.listeners) {
      try {
        const res = listener(event);
        if (res && typeof (res as Promise<void>).catch === "function") {
          (res as Promise<void>).catch(() => {
            // Isolate listener errors
          });
        }
      } catch {
        // Isolate synchronous listener errors
      }
    }

    return event;
  }

  recordRequest(entry: Omit<RecordedRequest, "id" | "timestamp" | "elapsedMs">): RecordedRequest {
    const redacted: RecordedRequest = {
      ...entry,
      id: `req_${crypto.randomUUID().slice(0, 10)}`,
      timestamp: new Date().toISOString(),
      elapsedMs: this.getElapsedMs(),
      url: this.redactor.redactUrl(entry.url),
      failureReason: entry.failureReason ? this.redactor.redactText(entry.failureReason) : undefined,
      headers: entry.headers ? this.redactor.redactHeaders(entry.headers) : undefined,
    };

    if (this.requests.length < this.maxRequests) {
      this.requests.push(redacted);
    } else {
      this.droppedRequests += 1;
    }

    return redacted;
  }

  updateRequest(id: string, patch: Partial<RecordedRequest>): void {
    const req = this.requests.find((r) => r.id === id);
    if (!req) return;
    if (patch.status !== undefined) req.status = patch.status;
    if (patch.durationMs !== undefined) req.durationMs = patch.durationMs;
    if (patch.failed !== undefined) req.failed = patch.failed;
    if (patch.failureReason !== undefined) {
      req.failureReason = this.redactor.redactText(patch.failureReason);
    }
    if (patch.injectedRuleId !== undefined) req.injectedRuleId = patch.injectedRuleId;
    if (patch.injectedFault !== undefined) req.injectedFault = patch.injectedFault;
    if (patch.fromServiceWorker !== undefined) req.fromServiceWorker = patch.fromServiceWorker;
  }

  recordConsole(type: string, text: string, location?: string): ConsoleEntry {
    const entry: ConsoleEntry = {
      timestamp: new Date().toISOString(),
      elapsedMs: this.getElapsedMs(),
      type,
      text: this.redactor.redactText(text),
      location: location ? this.redactor.redactUrl(location) : undefined,
    };
    this.consoleEntries.push(entry);
    if (type === "error" || type === "pageerror") {
      this.record(
        "console.error",
        {
          consoleType: type,
          text: entry.text,
          location: entry.location,
        },
        "error",
      );
    }
    return entry;
  }

  getEvents(): OfflineLabEvent[] {
    return [...this.events];
  }

  getRequests(): RecordedRequest[] {
    return [...this.requests];
  }

  getConsoleEntries(): ConsoleEntry[] {
    return [...this.consoleEntries];
  }

  getConsoleErrors(): ConsoleEntry[] {
    return this.consoleEntries.filter((e) => e.type === "error" || e.type === "pageerror");
  }

  getDroppedCounts(): { events: number; requests: number } {
    return {
      events: this.droppedEvents,
      requests: this.droppedRequests,
    };
  }
}
