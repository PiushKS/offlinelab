import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import { ConfigValidationError } from "../../core/errors/index.js";
import type { FaultRuleConfig, FaultType } from "../../types/index.js";

/**
 * Deterministic Mulberry32 PRNG for repeatable seeded fault injection.
 */
export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function isRegexLiteralPattern(pattern: string): boolean {
  if (!pattern.startsWith("/")) return false;
  const lastSlash = pattern.lastIndexOf("/");
  if (lastSlash <= 0) return false;
  const body = pattern.slice(1, lastSlash);
  const flags = pattern.slice(lastSlash + 1);
  if (!/^[dgimsuvy]*$/.test(flags)) return false;
  if (flags.length > 0) return true;
  // When ending with `/` and no flags, require regex metacharacters so plain paths like `/api/v1/` remain globs
  return /[\^$.*+?()[\]{}|\\]/.test(body);
}

/**
 * Compiles a URL glob pattern (supporting `**`, `*`, `?`) or `/regex/flags` into a RegExp.
 */
export function compileUrlPattern(pattern: string): RegExp {
  if (isRegexLiteralPattern(pattern)) {
    const lastSlash = pattern.lastIndexOf("/");
    const body = pattern.slice(1, lastSlash);
    const flags = pattern.slice(lastSlash + 1);
    return new RegExp(body, flags);
  }

  // Convert glob syntax safely into regex
  let regexStr = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch === "*" && pattern[i + 1] === "*") {
      regexStr += ".*";
      i += 2;
      // Optional trailing slash after ** when followed by /
      if (pattern[i] === "/") {
        regexStr += "/?";
        i += 1;
      }
      continue;
    }
    if (ch === "*") {
      regexStr += "[^/]*";
      i += 1;
      continue;
    }
    if (ch === "?") {
      regexStr += "[^/]";
      i += 1;
      continue;
    }
    if (/[.+^${}()|[\]\\]/.test(ch)) {
      regexStr += `\\${ch}`;
    } else {
      regexStr += ch;
    }
    i += 1;
  }

  return new RegExp(`^${regexStr}$`);
}

export function matchesUrlPattern(url: string, pattern: string): boolean {
  const regex = compileUrlPattern(pattern);
  if (regex.test(url)) return true;
  // Also allow matching pathname+search when pattern is a path glob starting with "/"
  if (pattern.startsWith("/") && !isRegexLiteralPattern(pattern)) {
    try {
      const parsed = new URL(url);
      return regex.test(parsed.pathname + parsed.search) || regex.test(parsed.pathname);
    } catch {
      return false;
    }
  }
  return false;
}

export interface RequestMatchInput {
  url: string;
  method: string;
  resourceType: string;
  nowMs?: number;
}

export interface MatchedFaultDecision {
  ruleId: string;
  fault: FaultType;
  rule: FaultRuleConfig;
  matchNumber: number;
}

interface InternalFaultRule {
  id: string;
  order: number;
  priority: number;
  config: FaultRuleConfig;
  urlRegex: RegExp;
  methods?: Set<string>;
  resourceTypes?: Set<string>;
  createdAtMs: number;
  matchedCount: number;
  triggeredCount: number;
  rng?: () => number;
}

export class FaultInjectionEngine {
  private readonly rules: InternalFaultRule[] = [];
  private sequenceCounter = 0;
  private currentPhase: string | undefined;

  setPhase(phase: string | undefined): void {
    this.currentPhase = phase;
  }

  getPhase(): string | undefined {
    return this.currentPhase;
  }

  addRule(config: FaultRuleConfig, nowMs = performance.now()): string {
    if (config.probability !== undefined) {
      if (
        typeof config.probability !== "number" ||
        Number.isNaN(config.probability) ||
        config.probability < 0 ||
        config.probability > 1
      ) {
        throw new ConfigValidationError(
          `Invalid probability "${String(config.probability)}": must be a fraction between 0 and 1 (e.g. 0.3 for 30%).`,
          { probability: config.probability },
        );
      }
    }

    if (config.fault === "http-status" && config.statusCode === undefined) {
      throw new ConfigValidationError(
        `Fault rule with fault "http-status" requires a numeric "statusCode".`,
      );
    }

    const id = config.id ?? `fault_${crypto.randomUUID().slice(0, 8)}`;
    // Replace existing rule with same ID if explicitly specified
    const existingIdx = this.rules.findIndex((r) => r.id === id);
    if (existingIdx !== -1) {
      this.rules.splice(existingIdx, 1);
    }

    const internal: InternalFaultRule = {
      id,
      order: this.sequenceCounter++,
      priority: config.priority ?? 0,
      config: { ...config, id },
      urlRegex: compileUrlPattern(config.url),
      methods: config.methods ? new Set(config.methods.map((m) => m.toUpperCase())) : undefined,
      resourceTypes: config.resourceTypes
        ? new Set(config.resourceTypes.map((r) => r.toLowerCase()))
        : undefined,
      createdAtMs: nowMs,
      matchedCount: 0,
      triggeredCount: 0,
      rng:
        config.probability !== undefined
          ? createSeededRng(config.seed ?? 42)
          : undefined,
    };

    this.rules.push(internal);
    // Deterministic rule precedence: higher priority first, then earliest registration order
    this.rules.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.order - b.order;
    });

    return id;
  }

  removeRule(id: string): boolean {
    const idx = this.rules.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    this.rules.splice(idx, 1);
    return true;
  }

  clearRules(): void {
    this.rules.length = 0;
  }

  listRules(): FaultRuleConfig[] {
    return this.rules.map((r) => ({ ...r.config }));
  }

  hasActiveRules(): boolean {
    return this.rules.length > 0;
  }

  evaluate(request: RequestMatchInput): MatchedFaultDecision | undefined {
    const now = request.nowMs ?? performance.now();
    const methodUpper = request.method.toUpperCase();
    const resourceLower = request.resourceType.toLowerCase();

    for (const rule of this.rules) {
      // Check phase scope
      if (rule.config.phase !== undefined && rule.config.phase !== this.currentPhase) {
        continue;
      }

      // Check duration window
      if (
        rule.config.durationMs !== undefined &&
        now - rule.createdAtMs > rule.config.durationMs
      ) {
        continue;
      }

      // Check URL match (full URL or pathname+search when pattern starts with /)
      if (!this.matchesUrl(rule, request.url)) {
        continue;
      }

      // Check method filter
      if (rule.methods && !rule.methods.has(methodUpper)) {
        continue;
      }

      // Check resource type filter
      if (rule.resourceTypes && !rule.resourceTypes.has(resourceLower)) {
        continue;
      }

      rule.matchedCount += 1;
      const matchNumber = rule.matchedCount;

      // Timing / count filters
      if (rule.config.once && rule.triggeredCount >= 1) {
        continue;
      }

      if (rule.config.firstN !== undefined && matchNumber > rule.config.firstN) {
        continue;
      }

      if (rule.config.everyNth !== undefined && matchNumber % rule.config.everyNth !== 0) {
        continue;
      }

      // Seeded deterministic probability filter
      if (rule.config.probability !== undefined && rule.rng) {
        const roll = rule.rng();
        if (roll >= rule.config.probability) {
          continue;
        }
      }

      rule.triggeredCount += 1;
      return {
        ruleId: rule.id,
        fault: rule.config.fault,
        rule: rule.config,
        matchNumber,
      };
    }

    return undefined;
  }

  private matchesUrl(rule: InternalFaultRule, url: string): boolean {
    if (rule.urlRegex.test(url)) return true;
    if (rule.config.url.startsWith("/") && !isRegexLiteralPattern(rule.config.url)) {
      try {
        const parsed = new URL(url);
        return (
          rule.urlRegex.test(parsed.pathname + parsed.search) ||
          rule.urlRegex.test(parsed.pathname)
        );
      } catch {
        return false;
      }
    }
    return false;
  }
}

export function faultToHttpStatus(fault: FaultType, customStatus?: number): number | undefined {
  switch (fault) {
    case "http-400":
      return 400;
    case "http-401":
      return 401;
    case "http-403":
      return 403;
    case "http-408":
      return 408;
    case "http-429":
      return 429;
    case "http-500":
      return 500;
    case "http-502":
      return 502;
    case "http-503":
      return 503;
    case "http-504":
      return 504;
    case "http-status":
      return customStatus ?? 500;
    default:
      return undefined;
  }
}
